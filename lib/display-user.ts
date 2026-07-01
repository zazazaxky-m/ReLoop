import { decrypt, isEncrypted } from "./encryption";

const PII_FIELDS = ["name", "email", "phone"] as const;
type PiiField = (typeof PII_FIELDS)[number];

function safeDecrypt(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return value ?? null;
  if (!isEncrypted(value)) return value;
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}

export function displayUserField(value: string | null | undefined): string | null {
  return safeDecrypt(value);
}

type UserLike = Record<string, unknown> | null | undefined;

export function displayUser<T extends UserLike>(user: T): T {
  if (!user) return user as T;
  const out: Record<string, unknown> = { ...user };
  for (const key of PII_FIELDS) {
    if (key in out) {
      out[key] = safeDecrypt(out[key] as string | null | undefined);
    }
  }
  return out as T;
}

export function displayUsers<T extends UserLike>(users: T[]): T[] {
  return users.map(displayUser);
}

export function displayUserFields<K extends PiiField>(fields: Partial<Record<K, string | null | undefined>>): Partial<Record<K, string | null>> {
  const out: Partial<Record<K, string | null>> = {};
  (Object.keys(fields) as K[]).forEach((key) => {
    out[key] = safeDecrypt(fields[key]);
  });
  return out;
}
