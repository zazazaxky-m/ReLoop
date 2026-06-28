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

        const where = a.where as Record<string, unknown> | undefined;
        if (where?.email) {
          where.email = encryptDeterministic(where.email as string);
        }

        const data = a.data as Record<string, unknown> | undefined;
        if (data) {
          if (data.name) data.name = encrypt(data.name as string);
          if (data.phone) data.phone = encrypt(data.phone as string);
          if (data.email) data.email = encryptDeterministic(data.email as string);
        }

        const createData = a.create as Record<string, unknown> | undefined;
        if (createData) {
          if (createData.name) createData.name = encrypt(createData.name as string);
          if (createData.phone) createData.phone = encrypt(createData.phone as string);
          if (createData.email) createData.email = encryptDeterministic(createData.email as string);
        }

        const updateData = a.update as Record<string, unknown> | undefined;
        if (updateData) {
          if (updateData.name) updateData.name = encrypt(updateData.name as string);
          if (updateData.phone) updateData.phone = encrypt(updateData.phone as string);
          if (updateData.email) updateData.email = encryptDeterministic(updateData.email as string);
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
