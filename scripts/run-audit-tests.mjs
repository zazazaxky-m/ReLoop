#!/usr/bin/env node
// Audit regression harness runner.
//
//   node scripts/run-audit-tests.mjs <integration|browser|realtime|python|flutter> [test args...]
//
// integration/browser/realtime: validates targets, starts an isolated Compose
// project (PostgreSQL 16 + Redis 7, unique name, Docker-allocated loopback
// ports), proves the live database identity, migrates it, starts the real
// Next.js dev server when needed, runs Vitest/Playwright with the forwarded
// arguments, then tears everything down. python: fresh venv + RVM unittest.
// flutter: `flutter test` from mobile/. Missing dependencies fail by name;
// nothing falls back to mocks. Secrets are generated per run and never printed.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLineRedactor, createRedactor, sanitizeArtifacts } from "./audit-redact.mjs";
import {
  AuditSafetyError,
  assertAuditTestEnvironment,
  assertLiveDatabaseIdentity,
  redactUrl,
  validateDatabaseUrl,
  validateRedisUrl,
} from "./audit-safety.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const IS_WINDOWS = process.platform === "win32";
const MODES = new Set(["integration", "browser", "realtime", "python", "flutter"]);
const DB_MODES = new Set(["integration", "browser", "realtime"]);
const COMPOSE_FILE = path.join(ROOT, "docker-compose.audit.yml");
// Nothing listens on port 1: realtime publishes from the Next child go nowhere
// instead of reaching some unrelated service on the developer's :3001.
const DISCARD_ORIGIN = "http://127.0.0.1:1";
const FLUTTER_VERSION_HINT = "Flutter 3.41.7 (Dart ^3.11.5, see mobile/pubspec.yaml)";
const PASSTHROUGH_ENV = [
  "PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TERM", "TMPDIR", "TEMP", "TMP", "SHELL",
  "CI", "GITHUB_ACTIONS", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "PLAYWRIGHT_BROWSERS_PATH",
  "PUB_CACHE", "FLUTTER_ROOT", "ANDROID_HOME", "JAVA_HOME", "npm_config_cache", "PIP_INDEX_URL",
  "PIP_CACHE_DIR", "SYSTEMROOT", "COMSPEC", "PATHEXT", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "WINDIR",
];
const DOCKER_ENV = ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY"];

class DependencyError extends Error {
  constructor(dependency, detail) {
    super(`missing dependency: ${dependency} — ${detail}`);
    this.name = "DependencyError";
  }
}

function pickEnv(names) {
  const env = {};
  for (const name of names) if (process.env[name] !== undefined) env[name] = process.env[name];
  return env;
}

function binPath(pkg, bin) {
  const pkgJsonPath = require.resolve(`${pkg}/package.json`);
  const { bin: bins } = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  const relative = typeof bins === "string" ? bins : bins[bin];
  return path.join(path.dirname(pkgJsonPath), relative);
}

async function freeLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createRun(mode, args) {
  const id = randomBytes(5).toString("hex");
  const secrets = {
    AUTH_JWT_SECRET: randomBytes(32).toString("hex"),
    ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    AUDIT_CHECKSUM_SECRET: randomBytes(32).toString("hex"),
    REALTIME_INTERNAL_SECRET: randomBytes(32).toString("hex"),
    AUDIT_FIXTURE_PASSWORD: `Audit-${randomBytes(12).toString("base64url")}-9!`,
    AUDIT_PG_PASSWORD: randomBytes(24).toString("hex"),
    AUDIT_REDIS_PASSWORD: randomBytes(24).toString("hex"),
  };
  const artifactDir = path.join(ROOT, "test-results", "audit", `${mode}-${id}`);
  const tmp = mkdtempSync(path.join(tmpdir(), `reloop-audit-${id}-`));
  mkdirSync(path.join(artifactDir, "logs"), { recursive: true });
  const redact = createRedactor({ secrets: Object.values(secrets) });
  return {
    id, mode, args, secrets, artifactDir, tmp, redact,
    project: `reloop-audit-${id}`,
    children: new Set(),
    processGroups: new WeakSet(),
    composeStarted: false,
    createdFiles: [],
  };
}

function log(run, message) {
  process.stdout.write(`[audit-runner] ${run ? run.redact(message) : message}\n`);
}

/** Spawns a child whose stdout/stderr are redacted line by line into a log file (and the terminal). */
function runChild(run, command, args, { env, cwd = ROOT, logName, echo = true, detached = false }) {
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached });
  run.children.add(child);
  if (detached) run.processGroups.add(child);
  const file = createWriteStream(path.join(run.artifactDir, "logs", logName), { flags: "a", mode: 0o600 });
  const tail = [];
  const emitTo = (stream) => (line) => {
    file.write(`${line}\n`);
    tail.push(line);
    if (tail.length > 60) tail.shift();
    if (echo) stream.write(`${line}\n`);
  };
  const out = createLineRedactor(run.redact, emitTo(process.stdout));
  const err = createLineRedactor(run.redact, emitTo(process.stderr));
  child.stdout.on("data", (chunk) => out.write(chunk));
  child.stderr.on("data", (chunk) => err.write(chunk));
  const exited = new Promise((resolve) => {
    child.once("error", (error) => {
      file.end();
      run.children.delete(child);
      resolve({ code: null, error });
    });
    child.once("close", (code, signal) => {
      out.end();
      err.end();
      file.end();
      run.children.delete(child);
      resolve({ code: code ?? (signal ? 1 : 0), signal });
    });
  });
  return { child, exited, tail };
}

async function runToCompletion(run, command, args, options) {
  const { exited, tail } = runChild(run, command, args, options);
  const result = await exited;
  return { ...result, tail };
}

function docker(run, args) {
  const env = { ...pickEnv([...PASSTHROUGH_ENV, ...DOCKER_ENV]) };
  if (run) {
    Object.assign(env, {
      AUDIT_RUN_ID: run.id,
      AUDIT_PG_PASSWORD: run.secrets.AUDIT_PG_PASSWORD,
      AUDIT_REDIS_PASSWORD: run.secrets.AUDIT_REDIS_PASSWORD,
    });
  }
  return spawnSync("docker", args, { cwd: ROOT, env, encoding: "utf8", timeout: 300_000 });
}

function compose(run, args) {
  // An empty env file keeps Compose from interpolating an operational ./.env.
  const envFile = path.join(run.tmp, "compose.env");
  if (!existsSync(envFile)) writeFileSync(envFile, "", { mode: 0o600 });
  return docker(run, ["compose", "--env-file", envFile, "-p", run.project, "-f", COMPOSE_FILE, ...args]);
}

function assertDockerAvailable() {
  const info = docker(null, ["info", "--format", "{{.ServerVersion}}"]);
  // Docker CLI 28 exits 0 with an empty version when the daemon is unreachable.
  if (info.error || info.status !== 0 || !info.stdout?.trim()) {
    throw new DependencyError(
      "Docker Engine",
      "`docker info` failed; PostgreSQL 16 and Redis 7 for the audit harness run in Docker (no mock fallback)",
    );
  }
  const version = docker(null, ["compose", "version", "--short"]);
  if (version.error || version.status !== 0) {
    throw new DependencyError("Docker Compose v2", "`docker compose version` failed");
  }
}

function resolvePort(run, service, containerPort) {
  const result = compose(run, ["port", service, String(containerPort)]);
  const match = /^127\.0\.0\.1:(\d+)$/.exec(result.stdout.trim());
  if (result.status !== 0 || !match) {
    throw new DependencyError(`${service} container`, `no loopback port published for ${containerPort}`);
  }
  return Number(match[1]);
}

function assertContainersOwned(run) {
  const ids = compose(run, ["ps", "-q"]).stdout.split(/\s+/).filter(Boolean);
  if (ids.length !== 2) {
    throw new AuditSafetyError(`expected 2 containers in ${run.project}, found ${ids.length}`);
  }
  const inspect = docker(null, ["inspect", "--format",
    '{{index .Config.Labels "com.reloop.audit.run"}} {{index .Config.Labels "com.docker.compose.project"}}', ...ids]);
  for (const line of inspect.stdout.trim().split("\n")) {
    if (line.trim() !== `${run.id} ${run.project}`) {
      throw new AuditSafetyError(`container labels "${line.trim()}" do not belong to audit run ${run.id}`);
    }
  }
}

function baseChildEnv(run) {
  const scratch = (name) => {
    const dir = path.join(run.tmp, name);
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  // Service passwords only travel inside DATABASE_URL/REDIS_URL.
  const { AUDIT_PG_PASSWORD: _pg, AUDIT_REDIS_PASSWORD: _redis, ...appSecrets } = run.secrets;
  return {
    ...pickEnv(PASSTHROUGH_ENV),
    ...appSecrets,
    AUDIT_TEST_RUN: "1",
    AUDIT_RUN_ID: run.id,
    AUDIT_ARTIFACT_DIR: run.artifactDir,
    AUDIT_TRANSPORT_SINK: path.join(run.tmp, "transport.jsonl"),
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_APP_NAME: "ReLoop",
    // Explicitly empty so Next/Prisma .env loading cannot inject real providers.
    RESEND_API_KEY: "",
    FIREBASE_SERVICE_ACCOUNT_JSON: "",
    MACHINE_INGEST_SECRET: "",
    TRUST_PROXY: "",
    EMAIL_FROM: "ReLoop Audit <noreply@reloop-audit.test>",
    REALTIME_PUBLISH_URL: `${DISCARD_ORIGIN}/publish`,
    REALTIME_WS_SESSION_URL: `${DISCARD_ORIGIN}/api/internal/ws-session`,
    NEXT_PUBLIC_REALTIME_WS_URL: "ws://127.0.0.1:1/ws",
    REDEMPTION_PROOF_STORAGE_DIR: scratch("redemption-proofs"),
    MACHINE_MEDIA_STORAGE_DIR: scratch("machine-media"),
    CAPTURE_STORAGE_DIR: scratch("captures"),
  };
}

async function verifyLiveDatabase(run, databaseUrl) {
  const { PrismaClient } = (await import("@prisma/client")).default;
  const client = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    let lastError;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const [row] = await client.$queryRawUnsafe(
          "SELECT current_database() AS database, current_setting('cluster_name') AS cluster");
        assertLiveDatabaseIdentity(row, run.id);
        return;
      } catch (error) {
        if (error instanceof AuditSafetyError) throw error;
        lastError = error;
        await sleep(500);
      }
    }
    throw new DependencyError("PostgreSQL 16", `unreachable at ${redactUrl(databaseUrl)}: ${lastError?.message ?? "unknown"}`);
  } finally {
    await client.$disconnect();
  }
}

async function claimRedis(run, redisUrl) {
  let Redis;
  try {
    Redis = (await import("ioredis")).default;
  } catch {
    throw new DependencyError("ioredis", "the optional dependency is required for the audit harness");
  }
  const client = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
  client.on("error", () => {});
  try {
    await client.connect();
    // Only a server started with this run's random requirepass accepts this.
    await client.set("reloop-audit:owner", run.id);
  } catch (error) {
    throw new DependencyError("Redis 7", `unreachable or not owned by this run at ${redactUrl(redisUrl)}: ${error.message}`);
  } finally {
    client.disconnect();
  }
}

async function startServices(run, env) {
  assertDockerAvailable();
  log(run, `starting isolated PostgreSQL 16 + Redis 7 (compose project ${run.project})`);
  run.composeStarted = true;
  const up = compose(run, ["up", "-d", "--wait", "--wait-timeout", "120"]);
  if (up.status !== 0) {
    const status = compose(run, ["ps", "--all", "--format", "{{.Service}} {{.State}} {{.Health}}"]).stdout;
    throw new DependencyError("PostgreSQL 16 / Redis 7 containers",
      `did not become healthy:\n${run.redact(`${up.stderr}\n${status}`)}`);
  }
  assertContainersOwned(run);
  const pgPort = resolvePort(run, "postgres", 5432);
  const redisPort = resolvePort(run, "redis", 6379);
  const databaseUrl =
    `postgresql://reloop_audit:${run.secrets.AUDIT_PG_PASSWORD}@127.0.0.1:${pgPort}/reloop_audit_test?schema=public&connect_timeout=5`;
  const redisUrl = `redis://:${run.secrets.AUDIT_REDIS_PASSWORD}@127.0.0.1:${redisPort}`;
  validateDatabaseUrl(databaseUrl, { inheritedDatabaseUrl: process.env.DATABASE_URL });
  validateRedisUrl(redisUrl, { inheritedRedisUrl: process.env.REDIS_URL });
  env.DATABASE_URL = databaseUrl;
  env.REDIS_URL = redisUrl;
  assertAuditTestEnvironment(env);
  log(run, `database ${redactUrl(databaseUrl)}, redis ${redactUrl(redisUrl)}`);

  const generate = await runToCompletion(run, process.execPath, [binPath("prisma", "prisma"), "generate"],
    { env, logName: "prisma.log", echo: false });
  if (generate.code !== 0) throw new DependencyError("Prisma client", "`prisma generate` failed; see logs/prisma.log");
  await verifyLiveDatabase(run, databaseUrl);
  await claimRedis(run, redisUrl);
  log(run, "live database identity verified (reloop_audit_test, cluster owned by this run); applying migrations");
  const migrate = await runToCompletion(run, process.execPath, [binPath("prisma", "prisma"), "migrate", "deploy"],
    { env, logName: "prisma.log", echo: false });
  if (migrate.code !== 0) throw new Error("`prisma migrate deploy` failed on the test database; see logs/prisma.log");
}

async function startNext(run, env) {
  const port = await freeLoopbackPort();
  const origin = `http://127.0.0.1:${port}`;
  env.AUDIT_BASE_URL = origin;
  env.NEXT_PUBLIC_BASE_URL = origin;
  log(run, `starting next dev on ${origin}`);
  const { exited, tail } = runChild(run, process.execPath,
    [binPath("next", "next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    { env, logName: "next.log", echo: false, detached: !IS_WINDOWS });
  let exitedEarly = null;
  exited.then((result) => { exitedEarly = result; });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (exitedEarly) {
      throw new DependencyError("Next.js dev server",
        `exited before serving (code ${exitedEarly.code}):\n${tail.slice(-20).join("\n")}`);
    }
    try {
      const response = await fetch(`${origin}/login`, { signal: AbortSignal.timeout(60_000) });
      if (response.ok) {
        log(run, "next dev is serving /login");
        return;
      }
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  throw new DependencyError("Next.js dev server", `did not serve ${origin}/login within 180s; see logs/next.log`);
}

function assertChromiumInstalled() {
  let executable;
  try {
    executable = require("playwright-core").chromium.executablePath();
  } catch {
    throw new DependencyError("@playwright/test", "not installed; run npm ci");
  }
  if (!executable || !existsSync(executable)) {
    throw new DependencyError("Playwright Chromium", "browser binary missing; run `npx playwright install chromium`");
  }
}

async function runDatabaseSuite(run) {
  const env = baseChildEnv(run);
  if (run.mode === "browser") assertChromiumInstalled();
  await startServices(run, env);
  if (run.mode !== "realtime") await startNext(run, env);
  const command = run.mode === "browser"
    ? [binPath("@playwright/test", "playwright"), "test", "-c", "playwright.config.ts", ...run.args]
    : [binPath("vitest", "vitest"), "run", "-c", `vitest.${run.mode}.config.ts`, ...run.args];
  log(run, `running ${run.mode} tests`);
  const result = await runToCompletion(run, process.execPath, command, { env, logName: "tests.log" });
  return result.code;
}

async function runPython(run) {
  const python = process.env.AUDIT_PYTHON || (IS_WINDOWS ? "python" : "python3");
  const probe = spawnSync(python, ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) throw new DependencyError("Python 3", `\`${python} --version\` failed`);
  const venv = path.join(run.tmp, "venv");
  const venvPython = path.join(venv, IS_WINDOWS ? "Scripts/python.exe" : "bin/python");
  const env = { ...pickEnv(PASSTHROUGH_ENV), PYTHONDONTWRITEBYTECODE: "1", TMPDIR: run.tmp, PIP_DISABLE_PIP_VERSION_CHECK: "1" };
  log(run, `creating isolated venv with ${probe.stdout.trim() || python}`);
  const created = await runToCompletion(run, python, ["-m", "venv", venv], { env, logName: "python.log", echo: false });
  if (created.code !== 0) throw new DependencyError("python venv module", "could not create a virtualenv");
  const installed = await runToCompletion(run, venvPython,
    ["-m", "pip", "install", "--quiet", "-r", path.join("rvm", "requirements.txt")],
    { env, logName: "python.log", echo: false });
  if (installed.code !== 0) {
    throw new DependencyError("rvm/requirements.txt (opencv-python-headless)",
      `pip install failed:\n${installed.tail.slice(-10).join("\n")}`);
  }
  log(run, "running RVM unittest suite (tests/test_rvm*.py)");
  const result = await runToCompletion(run, venvPython,
    ["-m", "unittest", "discover", "-s", "tests", "-p", "test_rvm*.py", ...run.args],
    { env, logName: "tests.log" });
  return result.code;
}

async function runFlutter(run) {
  const flutter = process.env.FLUTTER_BIN || "flutter";
  const probe = spawnSync(flutter, ["--version"], { encoding: "utf8", shell: IS_WINDOWS });
  if (probe.error || probe.status !== 0) {
    throw new DependencyError("Flutter SDK", `\`${flutter}\` not found on PATH; requires ${FLUTTER_VERSION_HINT}. Flutter gate NOT RUN.`);
  }
  const mobile = path.join(ROOT, "mobile");
  const envFile = path.join(mobile, ".env.test");
  if (!existsSync(envFile)) {
    // Declared asset in pubspec.yaml; test-only loopback value, removed after the run.
    writeFileSync(envFile, "API_BASE_URL=http://127.0.0.1:3000\n");
    run.createdFiles.push(envFile);
  }
  const env = { ...pickEnv(PASSTHROUGH_ENV) };
  const pub = await runToCompletion(run, flutter, ["pub", "get"], { env, cwd: mobile, logName: "flutter.log", echo: false });
  if (pub.code !== 0) throw new DependencyError("Flutter packages", `\`flutter pub get\` failed:\n${pub.tail.slice(-10).join("\n")}`);
  const result = await runToCompletion(run, flutter, ["test", ...run.args], { env, cwd: mobile, logName: "tests.log" });
  return result.code;
}

async function stopChild(run, child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("close", resolve));
  const signal = (sig) => {
    try {
      // next dev is spawned as a process-group leader so its workers die with it.
      if (run.processGroups.has(child) && child.pid) process.kill(-child.pid, sig);
      else child.kill(sig);
    } catch {
      try { child.kill(sig); } catch { /* already gone */ }
    }
  };
  signal("SIGTERM");
  const timedOut = await Promise.race([exited.then(() => false), sleep(10_000).then(() => true)]);
  if (timedOut) signal("SIGKILL");
}

async function cleanup(run) {
  for (const child of [...run.children]) await stopChild(run, child);
  let ok = true;
  if (run.composeStarted) {
    const down = compose(run, ["down", "--volumes", "--remove-orphans", "--timeout", "5"]);
    const leftovers = docker(null, ["ps", "-aq", "--filter", `label=com.docker.compose.project=${run.project}`]).stdout.trim();
    const volumes = docker(null, ["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${run.project}`]).stdout.trim();
    if (down.status !== 0 || leftovers || volumes) {
      ok = false;
      log(run, `WARNING: compose project ${run.project} was not fully removed; run: docker compose -p ${run.project} -f docker-compose.audit.yml down --volumes`);
    } else {
      log(run, `removed compose project ${run.project} (containers and volumes)`);
    }
  }
  for (const file of run.createdFiles) rmSync(file, { force: true });
  rmSync(run.tmp, { recursive: true, force: true });
  const findings = sanitizeArtifacts(run.artifactDir, { secrets: Object.values(run.secrets) });
  for (const finding of findings) {
    log(run, `sanitized artifact ${path.relative(ROOT, finding.file)} (${finding.kinds.join(", ")})${finding.binary ? " — deleted" : ""}`);
  }
  log(run, `artifacts: ${path.relative(ROOT, run.artifactDir)}`);
  return ok;
}

function usage() {
  return "usage: node scripts/run-audit-tests.mjs <integration|browser|realtime|python|flutter> [test args...]";
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (!MODES.has(mode)) {
    process.stderr.write(`${usage()}\n`);
    return 64;
  }
  const args = rest[0] === "--" ? rest.slice(1) : rest;
  const run = createRun(mode, args);
  let cleaning = null;
  const onSignal = (signal) => {
    log(run, `received ${signal}; cleaning up`);
    cleaning ??= cleanup(run);
    cleaning.finally(() => process.exit(130));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  let code = 1;
  try {
    if (DB_MODES.has(mode)) code = await runDatabaseSuite(run);
    else if (mode === "python") code = await runPython(run);
    else code = await runFlutter(run);
  } catch (error) {
    const kind = error instanceof DependencyError || error instanceof AuditSafetyError ? "" : "unexpected error: ";
    process.stderr.write(`[audit-runner] ✗ ${kind}${run.redact(error?.message ?? String(error))}\n`);
    code = error instanceof DependencyError || error instanceof AuditSafetyError ? 2 : 1;
  } finally {
    cleaning ??= cleanup(run);
    const cleaned = await cleaning;
    if (!cleaned && code === 0) code = 1;
  }
  return code;
}

process.exitCode = await main();
// Do not let a stray handle keep a finished run (and its CI job) alive.
setTimeout(() => process.exit(process.exitCode), 5_000).unref();
