import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const createSchema = z.object({
  provider: z.enum(["LINKAJA", "GOPAY", "OVO", "DANA", "SHOPEEPAY", "BANK", "OTHER"]),
  accountIdentifier: z.string().min(3).max(60),
  accountName: z.string().max(120).optional(),
});

export async function GET() {
  try {
    const user = await requireApiUser(["USER"]);
    const accounts = await prisma.payoutAccount.findMany({
      where: { userId: user.id, status: { not: "DISABLED" } },
      orderBy: { createdAt: "desc" },
    });
    return jsonOk({ accounts });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["USER"]);
    const data = createSchema.parse(await req.json());

    const account = await prisma.payoutAccount.create({
      data: {
        userId: user.id,
        provider: data.provider,
        accountIdentifier: data.accountIdentifier,
        accountName: data.accountName ?? null,
        // No KYC for MVP; usable immediately for manual transfer.
        status: "UNVERIFIED",
        kycRequired: false,
      },
    });

    await logAudit({
      actorId: user.id,
      action: "PAYOUT_ACCOUNT_CREATE",
      entityType: "PayoutAccount",
      entityId: account.id,
      metadata: { provider: data.provider },
    });

    return jsonOk({ account }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
