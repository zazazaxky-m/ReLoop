import { decrypt, isEncrypted } from "./encryption";

export function displayUserField(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  if (!isEncrypted(value)) return value;
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}
