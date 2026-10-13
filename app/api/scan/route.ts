import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { isTokenValid } from "@/lib/qr";
import { machineAcceptsSessions } from "@/lib/machine-state";
import { isCampaignEligible } from "@/lib/campaign";
import { logAudit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { campaignSupportsMachine } from "@/lib/reward-policy";

const CAMPAIGN_NOT_FOR_MACHINE = "Campaign ini tidak berlaku untuk setoran mesin";

const scanSchema = z.object({
  machineCode: z.string().min(1),
  token: z.string().optional(),
  campaignId: z.string().optional(),
});

// A dynamic QR token is short-lived but still guessable if unlimited
// attempts are allowed; cap per-user attempts instead of trusting entropy
// alone.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["USER"]);
    const rl = await checkRateLimit(`scan:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!rl.allowed) {
      throw new HttpError(429, "Terlalu banyak percobaan scan. Coba lagi sebentar lagi.");
    }
    const body = scanSchema.parse(await req.json());

    const machine = await prisma.machine.findUnique({
      where: { machineCode: body.machineCode },
      include: {
        organization: { select: { id: true, name: true, status: true } },
        wasteTypes: {
          where: { active: true },
          include: { wasteType: true },
        },
      },
    });

    if (!machine) throw new HttpError(404, "Mesin tidak ditemukan");
    if (!isTokenValid(machine, body.token ?? "")) {
      console.warn("[scan] invalid QR token", {
        machineCode: body.machineCode,
        userId: user.id,
      });
      throw new HttpError(
        401,
        "QR token tidak valid atau sudah kedaluwarsa. Silakan scan QR terbaru dari layar mesin.",
      );
    }
    if (!machineAcceptsSessions(machine.status)) {
      throw new HttpError(409, "Mesin tidak menerima setoran saat ini");
    }
    if (machine.organization.status !== "ACTIVE") {
      throw new HttpError(409, "Organisasi mesin tidak aktif");
    }
    if (machine.wasteTypes.length === 0) {
      throw new HttpError(409, "Mesin belum dikonfigurasi jenis sampah");
    }

    const activeSession = await prisma.depositSession.findFirst({
      where: {
        machineId: machine.id,
        status: { in: ["RESERVED", "ACTIVE", "PROCESSING_ITEM", "REVIEW"] },
      },
    });
    if (activeSession && activeSession.userId !== user.id) {
      throw new HttpError(409, "Mesin sedang digunakan pengguna lain");
    }
    if (activeSession && activeSession.userId === user.id) {
      return jsonOk({
        session: activeSession,
        machine: {
          id: machine.id,
          machineCode: machine.machineCode,
          name: machine.name,
          organizationName: machine.organization.name,
        },
        resumed: true,
      });
    }

    const campaignId = body.campaignId ?? null;
    if (campaignId) {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
      });
      if (!campaign || campaign.organizationId !== machine.organizationId) {
        throw new HttpError(422, "Campaign tidak valid untuk mesin ini");
      }
      // M04: only machine programs (MACHINE_DEPOSIT, or EVENT/SCHOOL_PROGRAM
      // with supportsMachine) can bind a deposit session; trip programs never.
      if (!campaignSupportsMachine(campaign)) {
        throw new HttpError(422, CAMPAIGN_NOT_FOR_MACHINE);
      }
      const eligibility = isCampaignEligible(campaign, user.email);
      if (!eligibility.eligible) {
        throw new HttpError(403, "Anda tidak memenuhi syarat campaign ini");
      }
    }

    const session = await prisma.depositSession.create({
      data: {
        userId: user.id,
        machineId: machine.id,
        campaignId,
        status: "ACTIVE",
        startedAt: new Date(),
        timeoutAt: new Date(Date.now() + machine.sessionIdleTimeoutMinutes * 60 * 1000),
      },
    });

    await logAudit({
      actorId: user.id,
      action: "DEPOSIT_SESSION_START",
      entityType: "DepositSession",
      entityId: session.id,
      metadata: { machineCode: machine.machineCode, campaignId },
    });

    return jsonOk(
      {
        session,
        machine: {
          id: machine.id,
          machineCode: machine.machineCode,
          name: machine.name,
          organizationName: machine.organization.name,
          supportedWasteTypes: machine.wasteTypes.map((w) => ({
            id: w.wasteType.id,
            name: w.wasteType.name,
          })),
        },
        resumed: false,
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
