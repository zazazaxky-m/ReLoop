import type { NotificationType, PickupRequest, PickupStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { logAuditInTransaction } from "./audit";
import { lockMachine, lockPickupRequest } from "./db-locks";
import { createNotification, sendPushToUsersBestEffort } from "./notifications";
import {
  PICKUP_OPEN,
  PICKUP_REASSIGNABLE,
  PICKUP_REPLACEABLE,
  describePickupDispatch,
  pickupActionRoles,
  resolvePickupTransition,
  type PickupAction,
  type PickupDispatchView,
} from "./pickup";
import { prisma } from "./prisma";
import { HttpError, type CurrentUser } from "./rbac";
import { afterCommitSafely, runWalletTransaction } from "./wallet-service";

/**
 * B05 (BIZ-04): pickup is admin dispatch and every task has one owner.
 *
 * ADMIN (own organization) or SUPERADMIN assigns one collector with an ACTIVE
 * partnership; the assigned PENGEPUL drives the field statuses. Each decision
 * is a compare-and-set on PickupRequest.version: the transaction locks the
 * pickup (lib/db-locks.ts: Machine -> PickupRequest), re-reads status, version,
 * assignee and the collector's partnership (FOR SHARE), then writes with a
 * conditional update that increments the version. Notifications go out only
 * after COMMIT, to the collectors and organization admins the change concerns.
 *
 * Client contract (docs/mobile-api.md "Pickup dispatch (B05)"): assign,
 * cancel and fail require `expectedVersion`; a different version is 409
 * PICKUP_VERSION_CONFLICT for every action. During the client upgrade window
 * the forward field actions (start, arrive, collect, complete) are still
 * accepted without `expectedVersion`, and only for the current assignee with
 * a live partnership at the status the action starts from; the write is still
 * conditional on the version read under the lock.
 */

export const PICKUP_VERSION_CONFLICT = "Tugas telah diperbarui; muat ulang";
export const PICKUP_VERSION_REQUIRED =
  "Versi tugas tidak dikirim. Muat ulang halaman atau perbarui aplikasi ReLoop, lalu coba lagi.";
export const PICKUP_FIELD_WORK_STARTED =
  "Pengepul sudah memulai pekerjaan lapangan. Batalkan atau tandai gagal dengan alasan, lalu buat tugas pengganti.";
export const PICKUP_CLOSED = "Tugas pickup sudah ditutup. Buat tugas pengganti bila masih perlu diambil.";
export const PICKUP_NOT_YOURS = "Tugas ini tidak lagi ditugaskan kepada Anda. Muat ulang daftar tugas.";
export const PARTNERSHIP_INACTIVE = "Kemitraan pengepul belum aktif untuk organisasi ini";
export const COLLECTOR_INACTIVE = "Akun pengepul tidak aktif";
export const REASON_REQUIRED = "Alasan wajib diisi (3-500 karakter)";
export const DEADLINE_INVALID = "Tenggat mulai harus berupa waktu yang akan datang (paling lama satu tahun)";

/** HttpError with a machine-readable code for clients (409 reload/upgrade hints). */
export class PickupDispatchError extends HttpError {
  constructor(
    status: number,
    message: string,
    public code: "PICKUP_VERSION_CONFLICT" | "PICKUP_VERSION_REQUIRED",
  ) {
    super(status, message);
    this.name = "PickupDispatchError";
  }
}

export const versionConflict = () => new PickupDispatchError(409, PICKUP_VERSION_CONFLICT, "PICKUP_VERSION_CONFLICT");
export const versionRequired = () => new PickupDispatchError(409, PICKUP_VERSION_REQUIRED, "PICKUP_VERSION_REQUIRED");

/** Actions that decide who owns the task, or close it: they always carry the operator's version. */
const VERSION_REQUIRED_ACTIONS = new Set<PickupAction>(["assign", "cancel", "fail"]);

export function requiresExpectedVersion(action: PickupAction): boolean {
  return VERSION_REQUIRED_ACTIONS.has(action);
}

const versionSchema = z.number().int().min(0).max(2_147_483_647);
const reasonSchema = z.string().trim().min(3).max(500);
const MAX_DEADLINE_MS = 366 * 86_400_000;

function parseExpectedVersion(value: unknown): number {
  const parsed = versionSchema.safeParse(value);
  if (!parsed.success) throw versionRequired();
  return parsed.data;
}

/** The deadline the operator chose; no default is invented when it is absent. */
export function parseExpectedStartAt(value: string | undefined | null, now = new Date()): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (!z.string().datetime({ offset: true }).safeParse(value).success) throw new HttpError(422, DEADLINE_INVALID);
  const deadline = new Date(value);
  const delta = deadline.getTime() - now.getTime();
  if (!(delta > 0) || delta > MAX_DEADLINE_MS) throw new HttpError(422, DEADLINE_INVALID);
  return deadline;
}

function parseReason(value: unknown): string {
  const parsed = reasonSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(422, REASON_REQUIRED);
  return parsed.data;
}

type Notice = { userId: string; type: NotificationType; title: string; body: string; data: Record<string, unknown> };

function pickupLabel(machine: { name: string } | null): string {
  return machine ? `mesin ${machine.name}` : "pickup manual";
}

/** Active ADMINs of the organization: the operators who own its dispatch. */
async function organizationAdminIds(organizationId: string): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: { organizationId, role: "ADMIN", status: "ACTIVE" },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return admins.map((admin) => admin.id);
}

async function notifyAdmins(organizationId: string, notice: Omit<Notice, "userId">): Promise<void> {
  const userIds = await organizationAdminIds(organizationId);
  if (userIds.length === 0) return;
  await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type: notice.type,
      title: notice.title,
      body: notice.body,
      dataJson: notice.data as Prisma.InputJsonValue,
    })),
  });
  // Awaited (it never throws): the escalation runner disconnects Prisma right
  // after its pass, and a push still querying device tokens would be lost.
  await sendPushToUsersBestEffort(userIds, notice.title, notice.body, notice.data);
}

async function deliver(notices: Notice[]): Promise<void> {
  for (const notice of notices) {
    await afterCommitSafely(`pickup notification ${notice.type}`, () => createNotification(notice));
  }
}

/** The collector's partnership with the organization, held FOR SHARE until COMMIT. */
async function lockedPartnership(tx: Prisma.TransactionClient, collectorUserId: string, organizationId: string) {
  const rows = await tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT id, status::text AS status FROM "OrganizationCollectorPartner"
    WHERE "organizationId" = ${organizationId} AND "collectorUserId" = ${collectorUserId}
    FOR SHARE`;
  const row = rows[0];
  return row && row.status === "ACTIVE" ? row : null;
}

async function readImmutable(pickupId: string) {
  const pickup = await prisma.pickupRequest.findUnique({
    where: { id: pickupId },
    // organizationId/machineId never change; assignedCollectorId is only a pre-filter.
    select: { id: true, organizationId: true, machineId: true, assignedCollectorId: true },
  });
  if (!pickup) throw new HttpError(404, "Pickup tidak ditemukan");
  return pickup;
}

function assertDispatcher(actor: CurrentUser, organizationId: string) {
  if (actor.role === "SUPERADMIN") return;
  if (actor.role === "ADMIN" && actor.organizationId === organizationId) return;
  if (actor.role === "ADMIN") throw new HttpError(403, "Di luar scope organisasi Anda");
  throw new HttpError(403, "Hanya admin organisasi yang dapat menugaskan pengepul");
}

/** Coarse role gate first, so a legacy client of the wrong role gets 403, not an upgrade hint. */
function assertActionRole(actor: CurrentUser, action: PickupAction) {
  if (pickupActionRoles(action).includes(actor.role)) return;
  throw new HttpError(403, action === "assign"
    ? "Penugasan pengepul dilakukan oleh admin organisasi"
    : "Peran tidak diizinkan untuk aksi ini");
}

const CURRENT_SELECT = {
  id: true, organizationId: true, machineId: true, status: true, version: true,
  assignedCollectorId: true, expectedStartAt: true,
  machine: { select: { name: true } },
} satisfies Prisma.PickupRequestSelect;

/**
 * Assigns (or reassigns, before field work starts) one collector with a live
 * ACTIVE partnership. `expectedVersion` is the version the operator saw; a
 * newer task is never replaced from an old snapshot.
 */
export async function assignPickup(
  actor: CurrentUser,
  pickupId: string,
  input: { collectorId: string; expectedVersion: number; expectedStartAt?: string },
): Promise<PickupRequest> {
  assertActionRole(actor, "assign");
  const expectedVersion = parseExpectedVersion(input.expectedVersion);
  const collectorId = z.string().min(1).max(128).safeParse(input.collectorId);
  if (!collectorId.success) throw new HttpError(422, "collectorUserId wajib diisi");
  const deadline = parseExpectedStartAt(input.expectedStartAt);
  const ref = await readImmutable(pickupId);
  assertDispatcher(actor, ref.organizationId);

  const outcome = await runWalletTransaction(async (tx) => {
    await lockPickupRequest(tx, pickupId);
    const current = await tx.pickupRequest.findUniqueOrThrow({ where: { id: pickupId }, select: CURRENT_SELECT });
    if (!PICKUP_REASSIGNABLE.includes(current.status)) {
      throw new HttpError(409, PICKUP_OPEN.includes(current.status) ? PICKUP_FIELD_WORK_STARTED : PICKUP_CLOSED);
    }
    if (current.version !== expectedVersion) throw versionConflict();

    const collector = await tx.user.findUnique({
      where: { id: collectorId.data },
      select: { id: true, role: true, status: true },
    });
    if (!collector || collector.role !== "PENGEPUL") throw new HttpError(422, "Pengepul tidak ditemukan");
    if (collector.status !== "ACTIVE") throw new HttpError(422, COLLECTOR_INACTIVE);
    const partner = await lockedPartnership(tx, collector.id, current.organizationId);
    if (!partner) throw new HttpError(403, PARTNERSHIP_INACTIVE);

    const id = pickupId;
    const changed = await tx.pickupRequest.updateMany({
      where: { id, version: expectedVersion, status: { in: ["REQUESTED", "ASSIGNED"] } },
      data: {
        assignedCollectorId: collector.id,
        collectorPartnerId: partner.id,
        status: "ASSIGNED",
        version: { increment: 1 },
        assignedAt: new Date(),
        expectedStartAt: deadline,
        // A new version starts a new escalation window (once per version).
        lastEscalatedAt: null,
      },
    });
    if (changed.count !== 1) throw new HttpError(409, "Tugas telah diperbarui; muat ulang");

    const updated = await tx.pickupRequest.findUniqueOrThrow({ where: { id } });
    await logAuditInTransaction(tx, {
      actorId: actor.id,
      action: "PICKUP_ASSIGN",
      entityType: "PickupRequest",
      entityId: id,
      metadata: {
        from: current.status, to: updated.status, version: updated.version,
        previousCollectorId: current.assignedCollectorId, assignedCollectorId: collector.id,
        expectedStartAt: deadline?.toISOString() ?? null,
      },
    });
    return { updated, previousCollectorId: current.assignedCollectorId, label: pickupLabel(current.machine) };
  });

  const { updated, previousCollectorId, label } = outcome;
  const reassigned = previousCollectorId !== null && previousCollectorId !== updated.assignedCollectorId;
  const notices: Notice[] = [{
    userId: updated.assignedCollectorId!,
    type: "PICKUP_ASSIGNED",
    title: previousCollectorId === updated.assignedCollectorId ? "Tugas pickup diperbarui" : "Tugas pickup baru",
    body: `Admin menugaskan Anda mengambil material dari ${label}. Periksa tenggat mulai di daftar tugas Anda.`,
    data: { pickupId: updated.id, version: updated.version },
  }];
  if (reassigned) {
    notices.push({
      userId: previousCollectorId!,
      type: "PICKUP_STATUS",
      title: "Tugas pickup dialihkan",
      body: `Tugas pickup ${label} dialihkan ke pengepul lain oleh admin. Jangan berangkat untuk tugas ini.`,
      data: { pickupId: updated.id, version: updated.version },
    });
  }
  await deliver(notices);
  return updated;
}

export interface TransitionPickupInput {
  action: Exclude<PickupAction, "assign">;
  /** Required for cancel/fail; optional (upgrade window) for start/arrive/collect/complete. */
  expectedVersion?: number;
  /** Required for cancel/fail. */
  reason?: string;
  notes?: string;
}

/**
 * Field transitions (assigned collector) and cancel (dispatcher). The actor,
 * the collector's live partnership, the version and the status are re-read
 * under the pickup lock; the write is conditional on that version.
 */
export async function transitionPickup(
  actor: CurrentUser,
  pickupId: string,
  input: TransitionPickupInput,
): Promise<PickupRequest> {
  const { action } = input;
  assertActionRole(actor, action);
  let expectedVersion: number | null = null;
  if (input.expectedVersion !== undefined) expectedVersion = parseExpectedVersion(input.expectedVersion);
  else if (requiresExpectedVersion(action)) throw versionRequired();
  const closing = action === "cancel" || action === "fail";
  const reason = closing ? parseReason(input.reason) : null;
  const ref = await readImmutable(pickupId);
  if (actor.role === "ADMIN" && actor.organizationId !== ref.organizationId) {
    throw new HttpError(403, "Di luar scope organisasi Anda");
  }
  // Unlocked pre-filter only (the decision re-reads the assignee under the lock):
  // a collector who is not the assignee never takes the machine/pickup locks.
  if (actor.role === "PENGEPUL" && ref.assignedCollectorId !== actor.id) throw new HttpError(403, PICKUP_NOT_YOURS);

  const outcome = await runWalletTransaction(async (tx) => {
    // Machine before PickupRequest (lib/db-locks.ts); only complete writes the machine.
    if (action === "complete" && ref.machineId) await lockMachine(tx, ref.machineId);
    await lockPickupRequest(tx, pickupId);
    const current = await tx.pickupRequest.findUniqueOrThrow({ where: { id: pickupId }, select: CURRENT_SELECT });

    const isAssignedCollector = actor.role === "PENGEPUL" && current.assignedCollectorId === actor.id;
    const resolution = resolvePickupTransition(action, {
      status: current.status,
      role: actor.role,
      isAssignedCollector,
      isOrgAdmin: actor.role === "ADMIN" && actor.organizationId === current.organizationId,
    });
    if (!resolution.ok && resolution.kind === "forbidden") {
      throw new HttpError(403, actor.role === "PENGEPUL" ? PICKUP_NOT_YOURS : resolution.error!);
    }
    // A collector whose partnership was suspended/removed is refused before any action.
    if (actor.role === "PENGEPUL" && !(await lockedPartnership(tx, actor.id, current.organizationId))) {
      throw new HttpError(403, PARTNERSHIP_INACTIVE);
    }
    if (expectedVersion !== null && current.version !== expectedVersion) throw versionConflict();
    if (!resolution.ok) throw new HttpError(409, resolution.error!);

    const changed = await tx.pickupRequest.updateMany({
      where: {
        id: pickupId,
        version: current.version,
        status: current.status,
        assignedCollectorId: current.assignedCollectorId,
      },
      data: {
        status: resolution.to!,
        version: { increment: 1 },
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(reason !== null ? { closedReason: reason } : {}),
      },
    });
    if (changed.count !== 1) throw versionConflict();

    // On completion, reset the machine so it can accept deposits again.
    if (action === "complete" && current.machineId) {
      const machine = await tx.machine.findUnique({ where: { id: current.machineId } });
      if (machine) {
        await tx.machine.update({
          where: { id: current.machineId },
          data: { fillLevelPercent: 0, status: machine.status === "FULL" ? "ONLINE" : machine.status },
        });
      }
    }

    const updated = await tx.pickupRequest.findUniqueOrThrow({ where: { id: pickupId } });
    await logAuditInTransaction(tx, {
      actorId: actor.id,
      action: `PICKUP_${action.toUpperCase()}`,
      entityType: "PickupRequest",
      entityId: pickupId,
      metadata: {
        from: current.status, to: updated.status, version: updated.version,
        assignedCollectorId: current.assignedCollectorId,
        expectedVersionProvided: expectedVersion !== null,
        ...(reason !== null ? { reason } : {}),
      },
    });
    return { updated, current };
  });

  const { updated, current } = outcome;
  const label = pickupLabel(current.machine);
  if (action === "cancel" && current.assignedCollectorId) {
    await deliver([{
      userId: current.assignedCollectorId,
      type: "PICKUP_STATUS",
      title: "Tugas pickup dibatalkan",
      body: `Admin membatalkan tugas pickup ${label}. Alasan: ${reason}. Jangan lanjutkan pengambilan.`,
      data: { pickupId, version: updated.version },
    }]);
  }
  if (action === "fail") {
    await afterCommitSafely("pickup fail notification", () => notifyAdmins(current.organizationId, {
      type: "PICKUP_STATUS",
      title: "Tugas pickup gagal",
      body: `Tugas pickup ${label} ditandai gagal. Alasan: ${reason}. Buat tugas pengganti bila material masih perlu diambil.`,
      data: { pickupId, version: updated.version },
    }));
  }
  return updated;
}

/**
 * The recorded reassignment path after a cancel/fail: one replacement task per
 * closed task (unique `replacesPickupId`), same organization and machine.
 * Retrying returns the existing replacement.
 */
export async function createReplacementPickup(
  actor: CurrentUser,
  closedPickupId: string,
  input: { priority?: number; notes?: string },
): Promise<{ pickup: PickupRequest; existing: boolean }> {
  const ref = await readImmutable(closedPickupId);
  assertDispatcher(actor, ref.organizationId);
  const outcome = await runWalletTransaction(async (tx) => {
    if (ref.machineId) await lockMachine(tx, ref.machineId);
    await lockPickupRequest(tx, closedPickupId);
    const closed = await tx.pickupRequest.findUniqueOrThrow({
      where: { id: closedPickupId },
      include: { replacedBy: true },
    });
    if (closed.replacedBy) return { pickup: closed.replacedBy, existing: true };
    if (!PICKUP_REPLACEABLE.includes(closed.status)) {
      throw new HttpError(409, "Hanya tugas yang dibatalkan atau gagal yang dapat diganti");
    }
    if (closed.machineId) {
      const open = await tx.pickupRequest.findFirst({
        where: { machineId: closed.machineId, status: { in: PICKUP_OPEN } },
        select: { id: true },
      });
      if (open) throw new HttpError(409, "Mesin ini sudah memiliki tugas pickup terbuka. Tugaskan tugas tersebut.");
    }
    const pickup = await tx.pickupRequest.create({
      data: {
        machineId: closed.machineId,
        organizationId: closed.organizationId,
        requestedById: actor.id,
        reason: closed.reason,
        priority: input.priority ?? closed.priority,
        notes: input.notes ?? closed.notes,
        status: "REQUESTED",
        replacesPickupId: closed.id,
      },
    });
    await logAuditInTransaction(tx, {
      actorId: actor.id,
      action: "PICKUP_CREATE",
      entityType: "PickupRequest",
      entityId: pickup.id,
      metadata: {
        organizationId: closed.organizationId, machineId: closed.machineId, reason: closed.reason,
        replacesPickupId: closed.id, replacedStatus: closed.status,
      },
    });
    return { pickup, existing: false };
  });
  return outcome;
}

export interface EscalationResult {
  pickupId: string;
  version: number;
  organizationId: string;
}

/**
 * Overdue escalation: an ASSIGNED task whose operator-chosen start deadline
 * passed without a start alerts the organization's active admins once per
 * (pickup, version). The claim is one conditional update on the version the
 * candidate was read at and `lastEscalatedAt IS NULL`; every dispatch resets
 * `lastEscalatedAt` and increments the version. It never reassigns. Runs
 * lazily on admin pickup reads and from scripts/process-pickup-escalations.ts.
 */
export async function escalateOverduePickups(
  options: { organizationId?: string; pickupIds?: string[]; limit?: number; now?: Date } = {},
): Promise<EscalationResult[]> {
  const now = options.now ?? new Date();
  const candidates = await prisma.pickupRequest.findMany({
    where: {
      status: "ASSIGNED",
      expectedStartAt: { lt: now },
      lastEscalatedAt: null,
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
      ...(options.pickupIds ? { id: { in: options.pickupIds } } : {}),
    },
    select: { id: true, version: true, organizationId: true, assignedCollectorId: true, expectedStartAt: true,
      machine: { select: { name: true } } },
    orderBy: [{ expectedStartAt: "asc" }, { id: "asc" }],
    take: options.limit ?? 50,
  });

  const escalated: EscalationResult[] = [];
  for (const candidate of candidates) {
    const claimed = await runWalletTransaction(async (tx) => {
      const changed = await tx.pickupRequest.updateMany({
        where: { id: candidate.id, version: candidate.version, status: "ASSIGNED",
          expectedStartAt: { lt: now }, lastEscalatedAt: null },
        data: { lastEscalatedAt: now },
      });
      if (changed.count !== 1) return false;
      await logAuditInTransaction(tx, {
        actorId: null,
        action: "PICKUP_ESCALATE",
        entityType: "PickupRequest",
        entityId: candidate.id,
        metadata: {
          version: candidate.version, assignedCollectorId: candidate.assignedCollectorId,
          expectedStartAt: candidate.expectedStartAt?.toISOString() ?? null,
        },
      });
      return true;
    });
    if (!claimed) continue;
    escalated.push({ pickupId: candidate.id, version: candidate.version, organizationId: candidate.organizationId });
    await afterCommitSafely("pickup escalation notification", () => notifyAdmins(candidate.organizationId, {
      type: "PICKUP_OVERDUE",
      title: "Pickup terlambat dimulai",
      body: `Pengepul yang ditugaskan belum berangkat untuk ${pickupLabel(candidate.machine)} setelah tenggat yang ditetapkan. Hubungi pengepul, tugaskan ulang, atau batalkan dengan alasan.`,
      data: { pickupId: candidate.id, version: candidate.version },
    }));
  }
  return escalated;
}

/**
 * Lazy escalation on an admin read: never fails the read. ADMIN reads escalate
 * their own organization only; SUPERADMIN reads any.
 */
export async function escalateOnAdminRead(actor: CurrentUser, options: { pickupIds?: string[] } = {}): Promise<void> {
  if (actor.role !== "ADMIN" && actor.role !== "SUPERADMIN") return;
  if (actor.role === "ADMIN" && !actor.organizationId) return;
  try {
    await escalateOverduePickups({
      organizationId: actor.role === "ADMIN" ? actor.organizationId! : undefined,
      pickupIds: options.pickupIds,
      limit: 20,
    });
  } catch (error) {
    console.error("[pickup] lazy escalation failed", error instanceof Error ? error.message : error);
  }
}

/** Response shape: the row plus who acts next and whether it is overdue. */
export function withDispatch<T extends { status: PickupStatus; expectedStartAt: Date | null; replacedBy?: { id: string } | null }>(
  pickup: T,
  now: Date = new Date(),
): T & { dispatch: PickupDispatchView } {
  return { ...pickup, dispatch: describePickupDispatch(pickup, now) };
}
