import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

function runRunner(args: string[], env: Record<string, string>) {
  const result = spawnSync(process.execPath, ["scripts/run-audit-tests.mjs", ...args], {
    cwd: ROOT, encoding: "utf8", timeout: 60_000,
    env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
  });
  const artifacts = /artifacts: (test-results\/audit\/\S+)/.exec(result.stdout)?.[1];
  if (artifacts) rmSync(path.join(ROOT, artifacts), { recursive: true, force: true });
  return result;
}

describe("run-audit-tests runner", () => {
  it("rejects an unknown suite with usage", () => {
    const result = runRunner(["everything"], {});
    expect(result.status).toBe(64);
    expect(result.stderr).toMatch(/usage: node scripts\/run-audit-tests\.mjs/);
  });

  it("fails by name, before creating any service, when Docker is unavailable", () => {
    const result = runRunner(["integration"], {
      DOCKER_HOST: "unix:///nonexistent/reloop-audit-docker.sock",
      DATABASE_URL: "postgresql://app:operational-secret@db.reloop.id:5432/reloop",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/missing dependency: Docker Engine/);
    expect(result.stdout).not.toMatch(/starting isolated PostgreSQL/);
    expect(`${result.stdout}${result.stderr}`).not.toContain("operational-secret");
  });

  it("reports the Flutter gate as not run when the SDK is missing", () => {
    const result = runRunner(["flutter"], { FLUTTER_BIN: "/nonexistent/flutter" });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/missing dependency: Flutter SDK .*Flutter gate NOT RUN/);
  });
});
