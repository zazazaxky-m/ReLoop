import { PrismaClient } from "@prisma/client";
import { encrypt, decrypt, isEncrypted, emailLookupHash } from "./encryption";

function decryptValue(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return value;
  if (!isEncrypted(value)) return value;
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}

// PII fields that may be encrypted in the User model. When we see a User-shaped
// object in any query result (including nested includes), decrypt these fields
// so callers never need to remember to call displayUser manually.
const PII_FIELDS = ["name", "email", "phone"] as const;

/** Caller already narrowed to a non-null object (see walkAndDecryptUsers). */
function looksLikeUser(obj: Record<string, unknown>): boolean {
  if (typeof obj.id !== "string") return false;
  return PII_FIELDS.some((f) => f in obj);
}

function decryptUserFieldsInPlace(obj: Record<string, unknown>): void {
  for (const field of PII_FIELDS) {
    if (field in obj && typeof obj[field] === "string") {
      obj[field] = decryptValue(obj[field]);
    }
  }
}

function walkAndDecryptUsers(value: unknown): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) walkAndDecryptUsers(item);
    return;
  }
  if (typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  if (looksLikeUser(obj)) {
    decryptUserFieldsInPlace(obj);
  }
  for (const key of Object.keys(obj)) {
    walkAndDecryptUsers(obj[key]);
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

// Extend with field-level encryption middleware.
// Cast back to PrismaClient for type compatibility with TransactionClient.
export const prisma = basePrisma.$extends({
  query: {
    $allOperations: async ({ args, query }) => {
      const result = await query(args);
      walkAndDecryptUsers(result);
      return result;
    },
    user: {
      async $allOperations({ args, query }) {
        const a = args as Record<string, unknown>;

        const processEncrypt = (val: unknown): unknown => {
          if (typeof val === "string") return encrypt(val);
          if (val && typeof val === "object") {
            const obj = val as Record<string, unknown>;
            if (typeof obj.equals === "string") obj.equals = encrypt(obj.equals);
            if (typeof obj.set === "string") obj.set = encrypt(obj.set);
            if (Array.isArray(obj.in)) {
              obj.in = obj.in.map((e) => (typeof e === "string" ? encrypt(e) : e));
            }
          }
          return val;
        };

        /** where.email → where.emailLookup (HMAC), so call sites stay unchanged. */
        const rewriteEmailWhere = (where: Record<string, unknown> | undefined) => {
          if (!where || where.email === undefined) return;
          const email = where.email;
          delete where.email;
          if (typeof email === "string") {
            where.emailLookup = emailLookupHash(email);
            return;
          }
          if (email && typeof email === "object") {
            const obj = email as Record<string, unknown>;
            const next: Record<string, unknown> = {};
            if (typeof obj.equals === "string") next.equals = emailLookupHash(obj.equals);
            if (Array.isArray(obj.in)) {
              next.in = obj.in.map((e) =>
                typeof e === "string" ? emailLookupHash(e) : e,
              );
            }
            where.emailLookup = Object.keys(next).length ? next : emailLookupHash(String(email));
          }
        };

        const stampEmailWrite = (bag: Record<string, unknown> | undefined) => {
          if (!bag) return;
          if (typeof bag.email === "string") {
            bag.emailLookup = emailLookupHash(bag.email);
            bag.email = encrypt(bag.email);
          } else if (bag.email && typeof bag.email === "object") {
            const obj = bag.email as Record<string, unknown>;
            if (typeof obj.set === "string") {
              bag.emailLookup = emailLookupHash(obj.set);
              obj.set = encrypt(obj.set);
            }
          }
          if (bag.name) bag.name = processEncrypt(bag.name);
          if (bag.phone) bag.phone = processEncrypt(bag.phone);
        };

        rewriteEmailWhere(a.where as Record<string, unknown> | undefined);
        stampEmailWrite(a.data as Record<string, unknown> | undefined);
        stampEmailWrite(a.create as Record<string, unknown> | undefined);
        stampEmailWrite(a.update as Record<string, unknown> | undefined);

        const result = await query(args);

        if (result) {
          const decryptFields = (item: Record<string, unknown>) => {
            if (item.name) item.name = decryptValue(item.name);
            if (item.phone) item.phone = decryptValue(item.phone);
            if (item.email) item.email = decryptValue(item.email);
          };
          if (Array.isArray(result)) {
            result.forEach(decryptFields);
          } else {
            decryptFields(result as Record<string, unknown>);
          }
        }

        return result;
      },
    },
    payoutAccount: {
      async $allOperations({ args, query }) {
        const a = args as Record<string, unknown>;
        const encryptField = (value: unknown) =>
          typeof value === "string" && value.length > 0 ? encrypt(value) : value;

        const data = a.data as Record<string, unknown> | undefined;
        if (data?.accountIdentifier) data.accountIdentifier = encryptField(data.accountIdentifier);
        if (data?.accountName) data.accountName = encryptField(data.accountName);

        const createData = a.create as Record<string, unknown> | undefined;
        if (createData?.accountIdentifier) {
          createData.accountIdentifier = encryptField(createData.accountIdentifier);
        }
        if (createData?.accountName) {
          createData.accountName = encryptField(createData.accountName);
        }

        const updateData = a.update as Record<string, unknown> | undefined;
        if (updateData?.accountIdentifier) {
          updateData.accountIdentifier = encryptField(updateData.accountIdentifier);
        }
        if (updateData?.accountName) {
          updateData.accountName = encryptField(updateData.accountName);
        }

        const result = await query(args);

        const decryptFields = (item: Record<string, unknown>) => {
          if (item.accountIdentifier) {
            item.accountIdentifier = decryptValue(item.accountIdentifier);
          }
          if (item.accountName) {
            item.accountName = decryptValue(item.accountName);
          }
        };

        if (result) {
          if (Array.isArray(result)) result.forEach(decryptFields);
          else decryptFields(result as Record<string, unknown>);
        }

        return result;
      },
    },
    machineCapture: {
      async $allOperations({ args, query }) {
        const a = args as Record<string, unknown>;
        const data = a.data as Record<string, unknown> | undefined;

        if (data?.facePathsJson) {
          data.facePathsJson = encrypt(
            typeof data.facePathsJson === "string"
              ? (data.facePathsJson as string)
              : JSON.stringify(data.facePathsJson),
          );
        }

        const result = await query(args);

        if (result) {
          const decryptFacePaths = (item: Record<string, unknown>) => {
            const fp = item.facePathsJson;
            if (fp && typeof fp === "string") {
              try {
                item.facePathsJson = JSON.parse(decrypt(fp));
              } catch {
                // not encrypted yet — leave as-is
              }
            }
          };
          if (Array.isArray(result)) {
            result.forEach(decryptFacePaths);
          } else {
            decryptFacePaths(result as Record<string, unknown>);
          }
        }

        return result;
      },
    },
  },
}) as unknown as PrismaClient;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = basePrisma;
}
