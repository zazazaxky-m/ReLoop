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
//   - an exception is blocked as soon as npm audit reports an available fix for
//     the advisory (fixAvailable true, a non-breaking upgrade, or any upgrade of
//     the vulnerable package itself). The owner either applies the fix or records
//     the exact fix string in the row's `reviewedFix` after re-triaging; a
//     different fix blocks again. A breaking change to some other package (for
//     example a major downgrade of a parent) is not treated as an available fix.
// Moderate/low advisories are listed in the summary count but do not gate.
//
// Severity labels are trimmed and lower-cased, then must be one of info, low,
// moderate, high, critical. Any other label, a missing severity, or an entry
// that is not an object is an input error (exit 2), never a silent pass.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const SEVERITIES = new Set(["info", "low", "moderate", "high", "critical"]);
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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeSeverity(value, where) {
  if (typeof value !== "string") {
    throw new InputError(`${where}: severity is missing or not a string`);
  }
  const label = value.trim().toLowerCase();
  if (!SEVERITIES.has(label)) {
    throw new InputError(`${where}: unknown severity "${value}" (expected ${[...SEVERITIES].join(", ")})`);
  }
  return label;
}

/**
 * The fix npm audit offers for a vulnerable package, as a string the owner can
 * record in `reviewedFix`, or null when none counts. A breaking change to a
 * different package (npm's usual "downgrade the parent" suggestion) is not a
 * fix of this package. An object without a boolean isSemVerMajor is treated as
 * a fix, so unfamiliar shapes err toward blocking.
 */
export function describeFix(fixAvailable, packageName) {
  if (fixAvailable === true) return "npm-audit-fix";
  if (isPlainObject(fixAvailable) && typeof fixAvailable.name === "string" && typeof fixAvailable.version === "string") {
    if (fixAvailable.isSemVerMajor === true && fixAvailable.name !== packageName) return null;
    return `${fixAvailable.name}@${fixAvailable.version}`;
  }
  return null;
}

/** Flatten an npm audit report into advisories, plus entries that cite none. */
export function collectAdvisories(report, label = "npm audit report") {
  if (!isPlainObject(report)) {
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
  if (!isPlainObject(vulnerabilities)) {
    throw new InputError(`${label} has no vulnerabilities object`);
  }

  const advisories = new Map();
  const unattributed = [];
  for (const [key, entry] of Object.entries(vulnerabilities)) {
    const where = `${label}, vulnerability "${key}"`;
    if (!isPlainObject(entry)) {
      throw new InputError(`${where}: entry is not an object`);
    }
    if (!Array.isArray(entry.via)) {
      throw new InputError(`${where}: "via" is missing or not an array`);
    }
    if (entry.fixAvailable !== undefined && typeof entry.fixAvailable !== "boolean" && !isPlainObject(entry.fixAvailable)) {
      throw new InputError(`${where}: "fixAvailable" must be a boolean or an object`);
    }
    const severity = normalizeSeverity(entry.severity, where);
    const objects = [];
    const references = [];
    for (const item of entry.via) {
      if (typeof item === "string") references.push(item);
      else if (isPlainObject(item)) objects.push(item);
      else throw new InputError(`${where}: "via" holds an item that is neither a package name nor an advisory object`);
    }
    for (const item of objects) {
      const name = item.name ?? entry.name ?? key;
      const id = advisoryId(item.url, item.source);
      const advisorySeverity = normalizeSeverity(item.severity, `${where}, advisory ${id}`);
      const mapKey = `${name}|${id}`;
      if (!advisories.has(mapKey)) {
        advisories.set(mapKey, {
          package: name,
          id,
          severity: advisorySeverity,
          title: item.title ?? "",
          url: item.url ?? "",
          range: item.range ?? "",
          fix: describeFix(entry.fixAvailable, name),
        });
      }
    }
    const danglingReference = references.some((name) => !Object.hasOwn(vulnerabilities, name));
    if (
      GATED_SEVERITIES.has(severity) &&
      objects.length === 0 &&
      (references.length === 0 || danglingReference)
    ) {
      unattributed.push({ package: entry.name ?? key, severity });
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
  if (advisory.fix && String(row.reviewedFix ?? "").trim() !== advisory.fix) {
    problems.push(
      `a fix is now available (${advisory.fix}); apply it, or re-triage and set reviewedFix to "${advisory.fix}" if it must be deferred`,
    );
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
  const reviewed = advisory.fix ? `; available fix ${advisory.fix} reviewed and deferred` : "";
  return `${head}${title}\n        -> exception until ${row.expiresAt}, scope ${row.scope}, owner ${row.owner}${reviewed}`;
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
