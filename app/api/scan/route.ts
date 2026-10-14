import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { startOrResumeDeposit } from "@/lib/deposit-session-service";

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

/**
 * Starts (201) or resumes (200, `resumed: true`) the caller's deposit session
 * on a machine. One active session per machine (R03): another user's live
 * session is a neutral 409 that never names its owner. The decision runs in
 * lib/deposit-session-service.ts under User -> Machine row locks, re-reading
 * the QR token, machine state, active sessions and campaign (M04 machine-
 * program guard included) before anything is created.
 */
export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["USER"]);
    const rl = await checkRateLimit(`scan:${user.id}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!rl.allowed) {
      throw new HttpError(429, "Terlalu banyak percobaan scan. Coba lagi sebentar lagi.");
    }
    const body = scanSchema.parse(await req.json());

    const { session, resumed } = await startOrResumeDeposit(user, {
      machineCode: body.machineCode,
      token: body.token ?? "",
      ...(body.campaignId ? { campaignId: body.campaignId } : {}),
    });

    // Display data for the response only (after commit; decides nothing).
    const machine = await prisma.machine.findUnique({
      where: { id: session.machineId },
      include: {
        organization: { select: { name: true } },
        wasteTypes: {
          where: { active: true },
          include: { wasteType: true },
        },
      },
    });

    return jsonOk(
      {
        session,
        machine: machine
          ? {
              id: machine.id,
              machineCode: machine.machineCode,
              name: machine.name,
              organizationName: machine.organization.name,
              supportedWasteTypes: machine.wasteTypes.map((w) => ({
                id: w.wasteType.id,
                name: w.wasteType.name,
              })),
            }
          : null,
        resumed,
      },
      resumed ? 200 : 201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
