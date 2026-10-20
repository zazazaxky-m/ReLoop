import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sendPasswordResetEmail } from "@/lib/mailer";
import { readCapturedTransport } from "@/lib/test-transport";

describe("sendPasswordResetEmail", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = originalEnv;
  });

  it("logs only a redacted notice in non-production when Resend is not configured", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AUDIT_TEST_RUN", "");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await sendPasswordResetEmail({
      to: "user@example.com",
      resetUrl: "http://localhost/reset?token=abc-secret-token",
    });

    expect(result).toEqual({ sent: false, provider: "log" });
    expect(info).toHaveBeenCalledTimes(1);
    const logged = info.mock.calls.flat().join(" ");
    expect(logged).not.toContain("abc-secret-token");
    expect(logged).not.toContain("reset?token");
    expect(logged).not.toContain("user@example.com");
  });

  it("captures mail in the audit test sink instead of calling Resend", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "reloop-mail-"));
    try {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("AUDIT_TEST_RUN", "1");
      vi.stubEnv("AUDIT_TRANSPORT_SINK", path.join(dir, "sink.jsonl"));
      process.env.RESEND_API_KEY = "re_should_not_be_used";
      const fetchMock = vi.spyOn(globalThis, "fetch");

      const result = await sendPasswordResetEmail({
        to: "user@example.test",
        resetUrl: "http://127.0.0.1/reset-password?token=abc",
      });

      expect(result).toEqual({ sent: true, provider: "test-capture" });
      expect(fetchMock).not.toHaveBeenCalled();
      const [mail] = readCapturedTransport(path.join(dir, "sink.jsonl"));
      expect(mail).toMatchObject({ kind: "mail", to: "user@example.test", subject: "Reset kata sandi ReLoop" });
      expect(mail.kind === "mail" && mail.text).toContain("/reset-password?token=abc");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sends via Resend when API key is configured", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "ReLoop <noreply@example.com>";

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
    } as Response);

    const result = await sendPasswordResetEmail({
      to: "user@example.com",
      resetUrl: "http://localhost/reset?token=abc",
    });

    expect(result).toEqual({ sent: true, provider: "resend" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer re_test_key",
        }),
      }),
    );
  });
});
