import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLineRedactor, createRedactor, findSecretLeaks, scanArtifacts } from "./audit-redact.mjs";

const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLWEiLCJyb2xlIjoiVVNFUiJ9.c2lnbmF0dXJlLXZhbHVlLXRlc3Q";
const runSecret = "4f9c2b7d1e8a6c3b5d0f7e2a9c4b1d6e";

describe("createRedactor", () => {
  const redact = createRedactor({ secrets: [runSecret, "Audit-pass-12345!"] });

  it.each([
    ["session cookie", `Cookie: theme=dark; reloop_session=${jwt}`, [jwt, "reloop_session=e"]],
    ["set-cookie header", `set-cookie: reloop_session=${jwt}; Path=/; HttpOnly`, [jwt]],
    ["bare JWT", `challengeToken ${jwt} issued`, [jwt]],
    ["bearer token", "Authorization: Bearer abc.def-ghi_jkl", ["abc.def-ghi_jkl"]],
    ["json password", `{"email":"a@x.test","password":"hunter2-long"}`, ["hunter2-long"]],
    ["json reset token", `{"devResetUrl":"http://127.0.0.1/reset-password?token=Zm9vYmFyYmF6"}`, ["Zm9vYmFyYmF6"]],
    ["query token", "GET /reset-password?token=Zm9vYmFyYmF6&x=1", ["Zm9vYmFyYmF6"]],
    ["invite token", "GET /invite?inviteToken=c2VjcmV0aW52aXRl", ["c2VjcmV0aW52aXRl"]],
    ["url credentials", "connecting to postgresql://audit:pg-pass-9@127.0.0.1:5432/db", ["pg-pass-9"]],
    ["secret env assignment", "AUTH_JWT_SECRET=abcdef0123456789 next", ["abcdef0123456789"]],
    ["known run secret", `value=${runSecret}`, [runSecret]],
    ["fixture password", "typed Audit-pass-12345! into the form", ["Audit-pass-12345!"]],
    ["full payout number", `{"accountIdentifier":"081234567890"}`, ["081234567890"]],
    ["payout number in prose", "transfer ke rekening 1234567890123 selesai", ["1234567890123"]],
  ])("masks %s", (_label, input, forbidden) => {
    const output = redact(input);
    for (const value of forbidden) expect(output).not.toContain(value);
    expect(findSecretLeaks(output, { secrets: [runSecret, "Audit-pass-12345!"] })).toEqual([]);
  });

  it("keeps the last four digits of payout numbers for debugging", () => {
    expect(redact("rekening 081234567890")).toContain("7890");
  });

  it("leaves ordinary log lines intact", () => {
    const line = "GET /api/wallet 200 in 35ms (compile: 12ms)";
    expect(redact(line)).toBe(line);
  });
});

describe("createLineRedactor", () => {
  it("redacts secrets split across stream chunks", () => {
    const out: string[] = [];
    const push = createLineRedactor(createRedactor({ secrets: [runSecret] }), (line) => out.push(line));
    push.write(`first ${runSecret.slice(0, 10)}`);
    push.write(`${runSecret.slice(10)} done\nsecond line\n`);
    push.end();
    expect(out.join("\n")).not.toContain(runSecret);
    expect(out).toHaveLength(2);
  });
});

describe("scanArtifacts", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reports leaking files by path and kind without echoing the secret", () => {
    dir = mkdtempSync(path.join(tmpdir(), "audit-redact-"));
    mkdirSync(path.join(dir, "logs"));
    writeFileSync(path.join(dir, "logs", "clean.log"), "GET /login 200\n");
    writeFileSync(path.join(dir, "logs", "leak.log"), `reloop_session=${jwt}\n`);
    writeFileSync(path.join(dir, "shot.png"), Buffer.concat([Buffer.from([0x89, 0x50]), Buffer.from(runSecret)]));
    const findings = scanArtifacts(dir, { secrets: [runSecret] });
    expect(findings.map((x) => path.basename(x.file)).sort()).toEqual(["leak.log", "shot.png"]);
    expect(JSON.stringify(findings)).not.toContain(runSecret);
    expect(JSON.stringify(findings)).not.toContain(jwt);
  });
});
