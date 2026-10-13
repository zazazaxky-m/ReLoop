import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditTransportSink, captureTransport, readCapturedTransport } from "./test-transport";

describe("audit test transport", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "reloop-transport-"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("is inactive unless the runner marked an audit test run", () => {
    vi.stubEnv("AUDIT_TEST_RUN", "");
    vi.stubEnv("AUDIT_TRANSPORT_SINK", path.join(dir, "sink.jsonl"));
    expect(auditTransportSink()).toBeNull();
  });

  it("is never honoured in production, even with AUDIT_TEST_RUN=1", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUDIT_TEST_RUN", "1");
    vi.stubEnv("AUDIT_TRANSPORT_SINK", path.join(dir, "sink.jsonl"));
    expect(auditTransportSink()).toBeNull();
  });

  it("refuses to fall through to a real provider when the sink path is missing", () => {
    vi.stubEnv("AUDIT_TEST_RUN", "1");
    vi.stubEnv("AUDIT_TRANSPORT_SINK", "");
    expect(() => auditTransportSink()).toThrow(/AUDIT_TRANSPORT_SINK/);
  });

  it("appends captured messages as JSON lines readable by the test process", () => {
    const sink = path.join(dir, "sink.jsonl");
    captureTransport(sink, { kind: "mail", to: "a@x.test", subject: "s", text: "t", html: "h" });
    captureTransport(sink, { kind: "push", tokens: ["d1"], title: "T", body: "B" });
    expect(readFileSync(sink, "utf8").trim().split("\n")).toHaveLength(2);
    expect(readCapturedTransport(sink).map((m) => m.kind)).toEqual(["mail", "push"]);
    expect(readCapturedTransport(path.join(dir, "missing.jsonl"))).toEqual([]);
  });
});
