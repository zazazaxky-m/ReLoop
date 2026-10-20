// Redaction for audit-run logs and artifacts. Child process output passes
// through createLineRedactor before it reaches the terminal or a log file, and
// sanitizeArtifacts re-checks everything on disk before CI uploads it.
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const MASK = "[REDACTED]";
const SECRET_ENV_NAMES = [
  "AUTH_JWT_SECRET", "ENCRYPTION_KEY", "AUDIT_CHECKSUM_SECRET", "REALTIME_INTERNAL_SECRET",
  "AUDIT_FIXTURE_PASSWORD", "AUDIT_PG_PASSWORD", "AUDIT_REDIS_PASSWORD", "RESEND_API_KEY",
  "FIREBASE_SERVICE_ACCOUNT_JSON", "MACHINE_INGEST_SECRET", "DATABASE_URL", "REDIS_URL",
];
const SECRET_JSON_KEYS = [
  "password", "newPassword", "currentPassword", "token", "challengeToken", "resetToken",
  "inviteToken", "secret", "totpSecret", "ingestSecret", "accountIdentifier", "devResetUrl",
  "cookie", "authorization",
];
const SECRET_QUERY_KEYS = ["token", "password", "inviteToken", "resetToken", "challengeToken", "secret"];

const JWT = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;
const URL_CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]*:[^\s/@]*@/gi;
const SESSION_COOKIE = /(reloop_session=)(?!\[REDACTED\])[^;\s"',]+/g;
const COOKIE_HEADER = /^(\s*(?:set-)?cookie\s*:\s*).+$/gim;
const BEARER = /(Bearer\s+)(?!\[REDACTED\])[A-Za-z0-9._~+/=-]+/gi;
const JSON_FIELD = new RegExp(`("(?:${SECRET_JSON_KEYS.join("|")})"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, "gi");
const QUERY_FIELD = new RegExp(`([?&;\\s](?:${SECRET_QUERY_KEYS.join("|")})=)(?!\\[REDACTED\\])[^&\\s"'#]+`, "gi");
const ENV_ASSIGNMENT = new RegExp(
  `\\b((?:${SECRET_ENV_NAMES.join("|")})\\s*[=:]\\s*)(?!\\[REDACTED\\])("[^"]*"|'[^']*'|\\S+)`, "g");
// Payout account/phone numbers: keep only the last four digits.
const LONG_NUMBER = /\b\d{8,19}\b/g;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function knownSecretPattern(secrets) {
  const values = [...new Set(secrets.filter((s) => typeof s === "string" && s.length >= 8))]
    .sort((a, b) => b.length - a.length);
  return values.length ? new RegExp(values.map(escapeRegExp).join("|"), "g") : null;
}

/**
 * Returns a pure string -> string redactor for the given per-run secrets.
 * @param {{ secrets?: string[] }} [options]
 * @returns {(input: string) => string}
 */
export function createRedactor({ secrets = [] } = {}) {
  const known = knownSecretPattern(secrets);
  return (input) => {
    let text = String(input);
    if (known) text = text.replace(known, MASK);
    return text
      .replace(COOKIE_HEADER, `$1${MASK}`)
      .replace(URL_CREDENTIALS, "$1***@")
      .replace(JWT, `${MASK}:jwt`)
      .replace(SESSION_COOKIE, `$1${MASK}`)
      .replace(BEARER, `$1${MASK}`)
      .replace(JSON_FIELD, `$1"${MASK}"`)
      .replace(QUERY_FIELD, `$1${MASK}`)
      .replace(ENV_ASSIGNMENT, `$1${MASK}`)
      .replace(LONG_NUMBER, (digits) => `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`);
  };
}

/**
 * Line-buffered stream adapter so secrets split across chunks are still caught.
 * @param {(input: string) => string} redact
 * @param {(line: string) => void} emit
 */
export function createLineRedactor(redact, emit) {
  let pending = "";
  return {
    write(chunk) {
      pending += String(chunk);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) emit(redact(line));
    },
    end() {
      if (pending) emit(redact(pending));
      pending = "";
    },
  };
}

/**
 * Names the kinds of secret found; never returns the secret itself.
 * @param {string} text
 * @param {{ secrets?: string[], binary?: boolean }} [options]
 * @returns {string[]}
 */
export function findSecretLeaks(text, { secrets = [], binary = false } = {}) {
  const kinds = new Set();
  const known = knownSecretPattern(secrets);
  if (known && known.test(text)) kinds.add("known-secret");
  if (new RegExp(SESSION_COOKIE.source).test(text)) kinds.add("session-cookie");
  if (new RegExp(JWT.source).test(text)) kinds.add("jwt");
  if (binary) return [...kinds];
  if (new RegExp(BEARER.source, "i").test(text)) kinds.add("bearer-token");
  if (new RegExp(URL_CREDENTIALS.source, "i").test(text)) kinds.add("url-credentials");
  if (new RegExp(`("(?:${SECRET_JSON_KEYS.join("|")})"\\s*:\\s*)"(?!\\[REDACTED\\])(?:[^"\\\\]|\\\\.)+"`, "i").test(text)) {
    kinds.add("secret-field");
  }
  if (new RegExp(QUERY_FIELD.source, "i").test(text)) kinds.add("secret-query-param");
  if (new RegExp(ENV_ASSIGNMENT.source).test(text)) kinds.add("secret-env");
  if (new RegExp(LONG_NUMBER.source).test(text)) kinds.add("payout-number");
  return [...kinds];
}

const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".webm", ".zip", ".gz"]);

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/**
 * Lists artifact files that contain anything secret-shaped.
 * @param {string} dir
 * @param {{ secrets?: string[] }} [options]
 * @returns {{ file: string, kinds: string[], binary: boolean }[]}
 */
export function scanArtifacts(dir, { secrets = [] } = {}) {
  try {
    if (!statSync(dir).isDirectory()) return [];
  } catch {
    return [];
  }
  const findings = [];
  for (const file of walk(dir)) {
    const binary = BINARY_EXTENSIONS.has(path.extname(file).toLowerCase());
    const content = readFileSync(file).toString(binary ? "latin1" : "utf8");
    const kinds = findSecretLeaks(content, { secrets, binary });
    if (kinds.length) findings.push({ file, kinds, binary });
  }
  return findings;
}

/**
 * Makes an artifact directory safe to upload: text files are redacted in
 * place, binary files that still carry a secret are deleted.
 * @param {string} dir
 * @param {{ secrets?: string[] }} [options]
 */
export function sanitizeArtifacts(dir, { secrets = [] } = {}) {
  const redact = createRedactor({ secrets });
  const findings = scanArtifacts(dir, { secrets });
  for (const finding of findings) {
    if (finding.binary) rmSync(finding.file, { force: true });
    else writeFileSync(finding.file, redact(readFileSync(finding.file, "utf8")));
  }
  return findings;
}
