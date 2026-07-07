import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { sendPasswordResetEmail } from "@/lib/mailer";

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

  it("logs reset links in non-production when Resend is not configured", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await sendPasswordResetEmail({
      to: "user@example.com",
      resetUrl: "http://localhost/reset?token=abc",
    });

    expect(result).toEqual({ sent: false, provider: "log" });
    expect(info).toHaveBeenCalled();
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
