import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
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

  // Docker CLI 28 (GitHub's ubuntu-24.04 runners) answers `docker info --format`
  // with exit 0 and an empty version when the daemon is unreachable; only the
  // client-side `compose version` still works.
  it("fails by name when docker info exits 0 without a server version", () => {
    const bin = mkdtempSync(path.join(os.tmpdir(), "reloop-fake-docker-"));
    writeFileSync(
      path.join(bin, "docker"),
      [
        "#!/bin/sh",
        'if [ "$1" = info ]; then echo "Cannot connect to the Docker daemon" >&2; echo; exit 0; fi',
        'if [ "$1 $2" = "compose version" ]; then echo 2.38.2; exit 0; fi',
        'echo "Cannot connect to the Docker daemon" >&2; exit 1',
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    try {
      const result = runRunner(["integration"], { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` });
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/missing dependency: Docker Engine/);
      expect(result.stdout).not.toMatch(/starting isolated PostgreSQL/);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it("reports the Flutter gate as not run when the SDK is missing", () => {
    const result = runRunner(["flutter"], { FLUTTER_BIN: "/nonexistent/flutter" });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/missing dependency: Flutter SDK .*Flutter gate NOT RUN/);
  });
});
