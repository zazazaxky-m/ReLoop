import { createHmac } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { verifyMachineRequest } from "@/lib/machine-auth";
import {
  currentMachineSession,
  isActiveSession,
  machineLeaseExpiry,
  sessionDeadline,
} from "@/lib/deposit-session-service";

/**
 * The RVM's session-bridge poll (rvm/sync.py `fetch_machine_session`).
 *
 * Lease contract (unchanged for the machine): `{ id, sessionId, userRef,
 * issuedAt, expiresAt, signature }`, signature = HMAC-SHA256(ingest secret,
 * `${id}.${sessionId}.${issuedAt}.${expiresAt}`); `lease: null` means "no
 * session: stop". R03 server rules behind it:
 *  - the timeout policy closes sessions past their deadline first
 *    (lib/deposit-session-service.ts);
 *  - a lease never outlives the session deadline or 300 s;
 *  - with several live sessions on the machine (legacy data from before the
 *    enforce migration) there is no lease (`sessionConflict: true`), never the
 *    newest one.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const machine = await prisma.machine.findUnique({
      where: { machineCode: code },
      select: {
        id: true,
        ingestSecret: true,
        sessionIdleTimeoutMinutes: true,
        wasteTypes: {
          where: { active: true },
          include: { wasteType: { select: { id: true, name: true, unit: true } } },
        },
      },
    });
    if (!machine) return jsonError(404, "Mesin tidak ditemukan");
    if (!machine.ingestSecret) return jsonError(401, "Secret mesin belum tersedia");

    const verdict = await verifyMachineRequest({
      machineId: machine.id,
      secret: machine.ingestSecret,
      timestamp: req.headers.get("x-reloop-timestamp"),
      nonce: req.headers.get("x-reloop-nonce"),
      signature: req.headers.get("x-reloop-signature"),
      rawBody: "",
    });
    if (!verdict.ok) {
      return jsonError(401, `Tanda tangan tidak valid (${verdict.reason})`);
    }

    const wasteTypes = (machine.wasteTypes ?? []).map((link) => ({
      id: link.wasteType.id,
      name: link.wasteType.name,
      unit: link.wasteType.unit,
    }));
    const idle = {
      lease: null,
      session: null,
      idleTimeoutMinutes: machine.sessionIdleTimeoutMinutes,
      wasteTypes,
    };

    const current = await currentMachineSession(machine);
    if (current.conflict) return jsonOk({ ...idle, sessionConflict: true });
    if (!current.sessionId) return jsonOk(idle);

    const session = await prisma.depositSession.findUnique({
      where: { id: current.sessionId },
      include: {
        user: { select: { id: true, name: true } },
        items: {
          include: { wasteType: { select: { id: true, name: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    const issuedAt = Math.floor(Date.now() / 1000);
    // Ended in the meantime, or deadline reached: no lease (the next poll closes it).
    const expiresAt =
      session && isActiveSession(session.status)
        ? machineLeaseExpiry(sessionDeadline(session, machine.sessionIdleTimeoutMinutes), issuedAt)
        : null;
    if (!session || expiresAt === null) return jsonOk(idle);

    const id = `lease-${session.id}`;
    const canonical = [id, session.id, issuedAt, expiresAt].join(".");
    const signature = createHmac("sha256", machine.ingestSecret)
      .update(canonical)
      .digest("hex");

    const totalQuantity = session.items.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
    const totalReward = session.items.reduce(
      (sum, item) => sum + item.rewardAmount,
      0,
    );

    return jsonOk({
      lease: {
        id,
        sessionId: session.id,
        userRef: session.user.id,
        issuedAt,
        expiresAt,
        signature,
      },
      session: {
        id: session.id,
        status: session.status,
        userName: session.user.name,
        startedAt: session.startedAt,
        timeoutAt: session.timeoutAt,
        totalQuantity,
        totalReward,
        items: session.items.map((item) => ({
          id: item.id,
          wasteTypeId: item.wasteType.id,
          wasteTypeName: item.wasteType.name,
          quantity: item.quantity,
          rewardAmount: item.rewardAmount,
          status: item.status,
        })),
      },
      idleTimeoutMinutes: machine.sessionIdleTimeoutMinutes,
      wasteTypes,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
