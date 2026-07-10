import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { sendPasswordResetEmail } from "@/lib/mailer";

const originalEnv = { ...process.env };

describe("mailer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("sends via resend when configured", async () => {
    process.env.RESEND_API_KEY = "test_key";
    process.env.EMAIL_FROM = "test@reloop.id";
    
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
    });

    const result = await sendPasswordResetEmail({ to: "user@example.com", resetUrl: "http://example.com" });
    expect(result.provider).toBe("resend");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test_key" })
      })
    );
  });

  it("throws error if resend fails with detail", async () => {
    process.env.RESEND_API_KEY = "test_key";
    
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: vi.fn().mockResolvedValue("Bad Request")
    });

    await expect(sendPasswordResetEmail({ to: "user@example.com", resetUrl: "http://example.com" })).rejects.toThrow("Gagal mengirim email reset (400): Bad Request");
  });

  it("throws error if resend fails without detail", async () => {
    process.env.RESEND_API_KEY = "test_key";
    
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockRejectedValue(new Error("fail"))
    });

    await expect(sendPasswordResetEmail({ to: "user@example.com", resetUrl: "http://example.com" })).rejects.toThrow("Gagal mengirim email reset (500)");
  });

  it("logs in dev when no api key", async () => {
    delete process.env.RESEND_API_KEY;
    (process.env as any).NODE_ENV = "development";
    
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    
    const result = await sendPasswordResetEmail({ to: "user@example.com", resetUrl: "http://example.com" });
    expect(result.provider).toBe("log");
    expect(consoleInfo).toHaveBeenCalled();
    
    consoleInfo.mockRestore();
  });

  it("warns in prod when no api key", async () => {
    delete process.env.RESEND_API_KEY;
    (process.env as any).NODE_ENV = "production";
    
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    
    const result = await sendPasswordResetEmail({ to: "user@example.com", resetUrl: "http://example.com" });
    expect(result.provider).toBe("none");
    expect(consoleWarn).toHaveBeenCalled();
    
    consoleWarn.mockRestore();
  });
});
