import { prisma } from "@/lib/prisma";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { verifyMachineRequest } from "@/lib/machine-auth";
import {
  LEASE_PROTOCOL_V2_REQUIRED,
  MACHINE_LEASE_PROTOCOL_HEADER,
  MACHINE_LEASE_PROTOCOL_VERSION,
} from "@/lib/machine-auth-constants";
import { signLeaseV1, signLeaseV2 } from "@/lib/machine-lease";
import {
  currentMachineSession,
  ensureSessionPolicy,
  isActiveSession,
  machineLeaseExpiry,
  sessionDeadline,
} from "@/lib/deposit-session-service";
import { findReservationByKey, isRewardFundingEnforced, sessionAdmissionKey } from "@/lib/reward-funding";
import { machineRewardMode } from "@/lib/reward-policy";
import { machinePolicyView, parseSessionPolicy, sessionLimits, sessionPolicyVersion } from "@/lib/session-policy";

/**
 * The RVM's session-bridge poll (rvm/sync.py `fetch_machine_session`).
 *
 * Lease contracts:
 *  - v1 (no `x-reloop-lease-protocol` header): `{ id, sessionId, userRef,
 *    issuedAt, expiresAt, signature }`, signature = HMAC-SHA256(ingest secret,
 *    `${id}.${sessionId}.${issuedAt}.${expiresAt}`). Kept for workers that do
 *    not know the signed caps: compliance sessions always; money sessions only
 *    while REWARD_FUNDING_ENFORCED is not true. Under enforcement a money
 *    session is refused to a v1 worker (`lease: null`, `leaseRefused`): it is
 *    never leased without its bound.
 *  - v2 (`x-reloop-lease-protocol: 2`, B01b): the v1 fields plus `version: 2`,
 *    `machineCode`, `reservationId`, `policyVersion`, `ceilingRupiah`,
 *    `maxItems`, signed over the canonical array of lib/machine-lease.ts, and
 *    the admission snapshot (`policy`) whose hash is `policyVersion`. A
 *    renewal re-signs the same reservation, ceiling and policy version; the
 *    RVM's consumed counter is its own and is never reset by a renewal.
 *  `lease: null` means "no session: stop". R03 server rules behind it:
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
        machineCode: true,
        organizationId: true,
        ingestSecret: true,
        sessionIdleTimeoutMinutes: true,
        organization: { select: { machineRewardMode: true } },
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
    const wantsV2 = req.headers.get(MACHINE_LEASE_PROTOCOL_HEADER)?.trim() === String(MACHINE_LEASE_PROTOCOL_VERSION);

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
        campaign: true,
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

    // B01b: the admission snapshot (created now for a session admitted before
    // B01b when a v2 worker asks); its mode decides what a v1 worker may get.
    const policy = wantsV2
      ? await ensureSessionPolicy(session.id)
      : parseSessionPolicy(session.policySnapshotJson);
    // Without a snapshot (admitted before B01b) the live mode decides; an
    // unreadable organization mode counts as money (fails closed for v1 workers).
    const mode = policy?.mode ?? machineRewardMode({
      campaign: session.campaign ?? null,
      organizationMode: machine.organization?.machineRewardMode ?? "MONEY_REWARD",
    });
    if (!wantsV2 && mode === "MONEY_REWARD" && isRewardFundingEnforced()) {
      console.error("[machine-session] money session refused to a lease v1 worker under funding enforcement; upgrade the RVM worker", {
        machineId: machine.id,
        sessionId: session.id,
      });
      return jsonOk({ ...idle, leaseRefused: LEASE_PROTOCOL_V2_REQUIRED });
    }

    const id = `lease-${session.id}`;
    let lease: Record<string, unknown>;
    if (wantsV2 && policy) {
      const reservation = mode === "MONEY_REWARD" ? await findReservationByKey(prisma, sessionAdmissionKey(session.id)) : null;
      const limits = sessionLimits(policy);
      lease = {
        ...signLeaseV2(machine.ingestSecret, {
          id,
          machineCode: machine.machineCode,
          sessionId: session.id,
          userRef: session.user.id,
          issuedAt,
          expiresAt,
          reservationId: reservation?.id ?? null,
          // Always the hash of the snapshot shipped below (the stored column is the same value).
          policyVersion: sessionPolicyVersion(policy),
          ceilingRupiah: limits.maxRewardRupiah,
          maxItems: limits.maxItems,
        }),
        policy: machinePolicyView(policy),
      };
    } else {
      lease = {
        id,
        sessionId: session.id,
        userRef: session.user.id,
        issuedAt,
        expiresAt,
        signature: signLeaseV1(machine.ingestSecret, { id, sessionId: session.id, issuedAt, expiresAt }),
      };
    }

    const totalQuantity = session.items.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
    const totalReward = session.items.reduce(
      (sum, item) => sum + item.rewardAmount,
      0,
    );

    return jsonOk({
      lease,
      ...(wantsV2 && policy ? { leaseProtocol: MACHINE_LEASE_PROTOCOL_VERSION } : {}),
      session: {
        id: session.id,
        status: session.status,
        userName: session.user.name,
        startedAt: session.startedAt,
        timeoutAt: session.timeoutAt,
        totalQuantity,
        totalReward,
        limits: sessionLimits(policy),
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
