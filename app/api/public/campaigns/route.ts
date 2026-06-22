import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleApiError, jsonOk } from "@/lib/api";

export async function GET(_req: NextRequest) {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { visibility: "PUBLIC", status: "ACTIVE" },
      include: {
        organization: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const enriched = campaigns.map((c) => ({
      ...c,
      allowedEmailDomains: c.allowedEmailDomainsJson
        ? (c.allowedEmailDomainsJson as unknown as string[])
        : [],
    }));

    return jsonOk({ campaigns: enriched });
  } catch (error) {
    return handleApiError(error);
  }
}
