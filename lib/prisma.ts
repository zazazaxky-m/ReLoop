import { PrismaClient } from "@prisma/client";
import { encrypt, decrypt, encryptDeterministic, isEncrypted } from "./encryption";

function decryptValue(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return value;
  if (!isEncrypted(value)) return value;
  try {
    return decrypt(value);
  } catch {
    return value;
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
    user: {
      async $allOperations({ args, query }) {
        const a = args as Record<string, unknown>;

        const processEncrypt = (val: unknown, deterministic = false): unknown => {
          if (typeof val === "string") return deterministic ? encryptDeterministic(val) : encrypt(val);
          if (val && typeof val === "object") {
            const obj = val as Record<string, unknown>;
            if (typeof obj.equals === "string") obj.equals = deterministic ? encryptDeterministic(obj.equals) : encrypt(obj.equals);
            if (typeof obj.set === "string") obj.set = deterministic ? encryptDeterministic(obj.set) : encrypt(obj.set);
            if (Array.isArray(obj.in)) obj.in = obj.in.map(e => typeof e === "string" ? (deterministic ? encryptDeterministic(e) : encrypt(e)) : e);
          }
          return val;
        };

        const where = a.where as Record<string, unknown> | undefined;
        if (where?.email) where.email = processEncrypt(where.email, true);

        const data = a.data as Record<string, unknown> | undefined;
        if (data) {
          if (data.name) data.name = processEncrypt(data.name);
          if (data.phone) data.phone = processEncrypt(data.phone);
          if (data.email) data.email = processEncrypt(data.email, true);
        }

        const createData = a.create as Record<string, unknown> | undefined;
        if (createData) {
          if (createData.name) createData.name = processEncrypt(createData.name);
          if (createData.phone) createData.phone = processEncrypt(createData.phone);
          if (createData.email) createData.email = processEncrypt(createData.email, true);
        }

        const updateData = a.update as Record<string, unknown> | undefined;
        if (updateData) {
          if (updateData.name) updateData.name = processEncrypt(updateData.name);
          if (updateData.phone) updateData.phone = processEncrypt(updateData.phone);
          if (updateData.email) updateData.email = processEncrypt(updateData.email, true);
        }

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
