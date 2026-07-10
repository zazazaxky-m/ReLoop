import { describe, expect, it, vi } from "vitest";
import { encrypt, decrypt, encryptDeterministic, isEncrypted } from "./encryption";

describe("lib/encryption", () => {
  it("encrypts and decrypts roundtrip", () => {
    const plain = "hello world";
    const cipher = encrypt(plain);
    expect(cipher).not.toBe(plain);
    expect(isEncrypted(cipher)).toBe(true);
    expect(decrypt(cipher)).toBe(plain);
  });

  it("rejects invalid ciphertext format", () => {
    expect(() => decrypt("bad")).toThrow("Invalid ciphertext format");
  });

  it("deterministic encryption produces same output for same input", () => {
    const plain = "repeatable";
    const a = encryptDeterministic(plain);
    const b = encryptDeterministic(plain);
    expect(a).toBe(b);
    expect(isEncrypted(a)).toBe(true);
    expect(decrypt(a)).toBe(plain);
  });

  it("isEncrypted returns false for plain text", () => {
    expect(isEncrypted("hello")).toBe(false);
    expect(isEncrypted("")).toBe(false);
  });

  it("throws in production when ENCRYPTION_KEY is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(() => encrypt("x")).toThrow("ENCRYPTION_KEY must be set in production");
    vi.unstubAllEnvs();
  });

  it("uses provided ENCRYPTION_KEY", () => {
    vi.stubEnv("ENCRYPTION_KEY", "my-custom-key");
    const plain = "custom key test";
    const cipher = encrypt(plain);
    expect(isEncrypted(cipher)).toBe(true);
    expect(decrypt(cipher)).toBe(plain);
    vi.unstubAllEnvs();
  });
});
