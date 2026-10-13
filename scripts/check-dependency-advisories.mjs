#!/usr/bin/env node
// Dependency advisory gate (SEC-07).
//
//   node scripts/check-dependency-advisories.mjs <npm-audit.json> <triage.json>
//        [--runtime <npm-audit-omit-dev.json>] [--now YYYY-MM-DD]
//
// Reads an `npm audit --json` report (auditReportVersion 2) and the triage file
// (docs/security/dependency-triage.json) and fails the build when a high or
// critical advisory is still present without a justified, dated decision.
//
// Exit codes
//   0  every high/critical advisory is covered by a valid, unexpired exception
//   1  at least one advisory blocks (see the policy below)
//   2  the inputs cannot be evaluated (bad arguments, npm audit error, malformed
//      JSON or triage rows). The gate fails closed rather than passing.
//
// Policy for each high/critical advisory that npm audit reports
//   - no triage row                        -> block (untriaged)
//   - decision "patched"                   -> block (the audit still reports it)
//   - runtimeReachable === true            -> block (must be fixed, not excepted)
//   - scope "production" and reachability
//     not proven false                     -> block (unresolved blocks runtime)
//   - decision "exception" additionally needs an owner, a mitigation and an
//     `expiresAt` date that is not past and not more than 90 days away. Dev and
//     build scopes are not ignored: they need the same owner, mitigation and date.
//   - with --runtime, an advisory that `npm audit --omit=dev` also reports must
//     carry scope "production"; it cannot be relabelled dev/build.
// Moderate/low advisories are listed in the summary count but do not gate.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const GATED_SEVERITIES = new Set(["high", "critical"]);
export const SCOPES = new Set(["production", "build", "dev"]);
export const DECISIONS = new Set(["patched", "exception"]);
export const MAX_EXCEPTION_DAYS = 90;

const GHSA_PATTERN = /GHSA(?:-[a-z0-9]{4}){3}/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

class InputError extends Error {}

function usage() {
  return [
    "usage: node scripts/check-dependency-advisories.mjs <npm-audit.json> <triage.json>",
    "         [--runtime <npm-audit-omit-dev.json>] [--now YYYY-MM-DD]",
  ].join("\n");
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--runtime" || arg === "--now") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new InputError(`${arg} needs a value\n${usage()}`);
      }
      options[arg.slice(2)] = value;
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new InputError(`unknown option ${arg}\n${usage()}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) {
    throw new InputError(usage());
  }
  return { auditPath: positional[0], triagePath: positional[1], ...options };
}

function readJson(file, label) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new InputError(`cannot read ${label} ${file}: ${error.code ?? error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new InputError(`${label} ${file} is not valid JSON`);
  }
}

function parseDate(value) {
  if (typeof value !== "string") return null;
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return time;
}

function todayUtc(nowOption) {
  if (nowOption !== undefined) {
    const parsed = parseDate(nowOption);
    if (parsed === null) throw new InputError(`--now must be a real YYYY-MM-DD date, got "${nowOption}"`);
    return parsed;
  }
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function advisoryId(url, source) {
  const ghsa = typeof url === "string" ? GHSA_PATTERN.exec(url) : null;
  if (ghsa) return ghsa[0].toUpperCase();
  return source === undefined || source === null ? "UNKNOWN" : `NPM-${source}`;
}

function normalizeAdvisoryRef(value) {
  const text = String(value).trim();
  const ghsa = GHSA_PATTERN.exec(text);
  return ghsa ? ghsa[0].toUpperCase() : text.toUpperCase();
}

/** Flatten an npm audit report into advisories, plus entries that cite none. */
export function collectAdvisories(report, label = "npm audit report") {
  if (report === null || typeof report !== "object" || Array.isArray(report)) {
    throw new InputError(`${label} is not a JSON object`);
  }
  if (report.error) {
    const detail = typeof report.error === "string" ? report.error : (report.error.summary ?? report.error.code);
    throw new InputError(`${label} contains an npm audit error (${detail ?? "unknown"}); results are not trustworthy`);
  }
  if (report.auditReportVersion !== 2) {
    throw new InputError(`${label} has auditReportVersion ${String(report.auditReportVersion)}; expected 2`);
  }
  const vulnerabilities = report.vulnerabilities;
  if (vulnerabilities === null || typeof vulnerabilities !== "object" || Array.isArray(vulnerabilities)) {
    throw new InputError(`${label} has no vulnerabilities object`);
  }

  const advisories = new Map();
  const unattributed = [];
  for (const [key, entry] of Object.entries(vulnerabilities)) {
    const via = Array.isArray(entry?.via) ? entry.via : [];
    const objects = via.filter((item) => item !== null && typeof item === "object");
    const references = via.filter((item) => typeof item === "string");
    for (const item of objects) {
      const name = item.name ?? entry.name ?? key;
      const id = advisoryId(item.url, item.source);
      const mapKey = `${name}|${id}`;
      if (!advisories.has(mapKey)) {
        advisories.set(mapKey, {
          package: name,
          id,
          severity: String(item.severity ?? "unknown").toLowerCase(),
          title: item.title ?? "",
          url: item.url ?? "",
          range: item.range ?? "",
        });
      }
    }
    const severity = String(entry?.severity ?? "").toLowerCase();
    const danglingReference = references.some((name) => !Object.hasOwn(vulnerabilities, name));
    if (
      GATED_SEVERITIES.has(severity) &&
      objects.length === 0 &&
      (references.length === 0 || danglingReference)
    ) {
      unattributed.push({ package: entry?.name ?? key, severity });
    }
  }
  return { advisories: [...advisories.values()], unattributed };
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** Validate triage shape. Anything the gate cannot interpret is an input error. */
export function loadTriageRows(triage) {
  const rows = Array.isArray(triage) ? triage : triage?.rows;
  if (!Array.isArray(rows)) {
    throw new InputError('triage file must be an array of rows or an object with a "rows" array');
  }
  const seen = new Set();
  return rows.map((raw, index) => {
    const where = `triage row ${index + 1}`;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new InputError(`${where} is not an object`);
    }
    for (const field of ["package", "advisory"]) {
      if (!nonEmptyString(raw[field])) throw new InputError(`${where}: "${field}" must be a non-empty string`);
    }
    if (!SCOPES.has(raw.scope)) {
      throw new InputError(`${where} (${raw.package}): scope must be one of ${[...SCOPES].join(", ")}`);
    }
    if (!DECISIONS.has(raw.decision)) {
      throw new InputError(`${where} (${raw.package}): decision must be one of ${[...DECISIONS].join(", ")}`);
    }
    if (raw.runtimeReachable !== true && raw.runtimeReachable !== false && raw.runtimeReachable !== "unresolved") {
      throw new InputError(`${where} (${raw.package}): runtimeReachable must be true, false or "unresolved"`);
    }
    const id = normalizeAdvisoryRef(raw.advisory);
    const key = `${raw.package}|${id}`;
    if (seen.has(key)) throw new InputError(`${where}: duplicate row for ${raw.package} ${id}`);
    seen.add(key);
    return { ...raw, id, key };
  });
}

function exceptionProblems(row, advisory, today, runtimeKeys) {
  const problems = [];
  if (row.runtimeReachable === true) {
    problems.push("reachable at runtime and not fixed; upgrade instead of excepting");
  }
  if (row.scope === "production" && row.runtimeReachable === "unresolved") {
    problems.push("reachability is unresolved for production scope");
  }
  if (runtimeKeys && runtimeKeys.has(`${advisory.package}|${advisory.id}`) && row.scope !== "production") {
    problems.push(`npm audit --omit=dev reports it, so scope must be production (row says ${row.scope})`);
  }
  if (!nonEmptyString(row.owner)) problems.push("no owner");
  if (!nonEmptyString(row.mitigation)) problems.push("no mitigation recorded");

  const expires = parseDate(row.expiresAt);
  if (expires === null) {
    problems.push("expiresAt is missing or not a real YYYY-MM-DD date");
  } else if (expires < today) {
    problems.push(`exception expired on ${row.expiresAt}`);
  } else if ((expires - today) / DAY_MS > MAX_EXCEPTION_DAYS) {
    problems.push(`expiresAt ${row.expiresAt} is more than ${MAX_EXCEPTION_DAYS} days away`);
  }
  return problems;
}

export function evaluate({ audit, runtimeAudit, rows, today }) {
  const { advisories, unattributed } = collectAdvisories(audit, "npm audit report");
  const runtimeKeys = runtimeAudit
    ? new Set(
        collectAdvisories(runtimeAudit, "runtime npm audit report").advisories.map(
          (item) => `${item.package}|${item.id}`,
        ),
      )
    : null;
  const rowsByKey = new Map(rows.map((row) => [row.key, row]));

  const results = [];
  const matched = new Set();
  let notGated = 0;
  for (const advisory of advisories) {
    if (!GATED_SEVERITIES.has(advisory.severity)) {
      notGated += 1;
      continue;
    }
    const key = `${advisory.package}|${advisory.id}`;
    const row = rowsByKey.get(key);
    if (row) matched.add(key);
    if (!row) {
      results.push({ advisory, row, status: "block", reasons: ["untriaged high/critical advisory"] });
    } else if (row.decision === "patched") {
      results.push({
        advisory,
        row,
        status: "block",
        reasons: ["triage marks it patched but npm audit still reports it (stale triage or incomplete upgrade)"],
      });
    } else {
      const problems = exceptionProblems(row, advisory, today, runtimeKeys);
      results.push({ advisory, row, status: problems.length ? "block" : "excepted", reasons: problems });
    }
  }
  for (const item of unattributed) {
    results.push({
      advisory: { package: item.package, id: "UNATTRIBUTED", severity: item.severity, title: "" },
      row: undefined,
      status: "block",
      reasons: [
        "audit entry cites no advisory and a package that is not in the report; regenerate the audit before trusting it",
      ],
    });
  }

  // A "patched" row that the audit no longer reports is the expected end state
  // and stays as the record. An exception the audit no longer needs is stale.
  const stale = rows.filter((row) => row.decision === "exception" && !matched.has(row.key));
  return { results, stale, notGated };
}

function formatResult({ advisory, row, status, reasons }) {
  const head = `${status === "block" ? "BLOCK" : "OK   "}  ${advisory.package}  ${advisory.id}  ${advisory.severity}`;
  const title = advisory.title ? `\n        ${advisory.title}` : "";
  if (status === "block") {
    return `${head}${title}\n        -> ${reasons.join("; ")}`;
  }
  return `${head}${title}\n        -> exception until ${row.expiresAt}, scope ${row.scope}, owner ${row.owner}`;
}

export function main(argv, io = { out: console.log, err: console.error }) {
  let args;
  try {
    args = parseArgs(argv);
    const today = todayUtc(args.now);
    const audit = readJson(args.auditPath, "audit report");
    const runtimeAudit = args.runtime ? readJson(args.runtime, "runtime audit report") : undefined;
    const rows = loadTriageRows(readJson(args.triagePath, "triage file"));
    const { results, stale, notGated } = evaluate({ audit, runtimeAudit, rows, today });

    const blocked = results.filter((item) => item.status === "block");
    const excepted = results.filter((item) => item.status === "excepted");
    io.out(`Dependency advisory gate (${results.length} high/critical advisories, ${notGated} moderate/low not gated)`);
    for (const item of results) io.out(formatResult(item));
    for (const row of stale) {
      io.out(`WARN   exception for ${row.package} ${row.id} is no longer needed (advisory not reported); mark it patched or remove it`);
    }
    io.out(`Result: ${blocked.length} blocking, ${excepted.length} excepted`);
    if (blocked.length > 0) {
      io.err(`FAIL: ${blocked.length} high/critical advisory finding(s) block this build.`);
      return 1;
    }
    return 0;
  } catch (error) {
    if (error instanceof InputError) {
      io.err(`ERROR: ${error.message}`);
      return 2;
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
