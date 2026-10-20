import type { PickupStatus, Role } from "@prisma/client";

export type PickupAction =
  | "assign"
  | "start"
  | "arrive"
  | "collect"
  | "complete"
  | "fail"
  | "cancel";

interface PickupRule {
  from: PickupStatus[];
  to: PickupStatus;
  roles: Role[];
  /** "collector" => must be the assigned collector; "admin" => org admin. */
  actor: "collector" | "admin" | "any";
}

/**
 * Pickup lifecycle (B05: admin dispatch, the task has one owner):
 * REQUESTED -> ASSIGNED -> ON_THE_WAY -> ARRIVED -> COLLECTED -> COMPLETED
 * with FAILED/CANCELLED escape hatches. ADMIN/SUPERADMIN assign one ACTIVE
 * partner and may reassign only before field work starts (REQUESTED/ASSIGNED).
 * Once the collector has left, a change of collector is a cancel (admin, until
 * the material is loaded) or a fail (the assigned collector), each with a
 * reason, followed by an explicit replacement task. The assigned collector
 * drives the field statuses; there is no collector self-claim.
 */
const RULES: Record<PickupAction, PickupRule> = {
  assign: {
    from: ["REQUESTED", "ASSIGNED"],
    to: "ASSIGNED",
    roles: ["ADMIN", "SUPERADMIN"],
    actor: "admin",
  },
  start: {
    from: ["ASSIGNED"],
    to: "ON_THE_WAY",
    roles: ["PENGEPUL", "SUPERADMIN"],
    actor: "collector",
  },
  arrive: {
    from: ["ON_THE_WAY"],
    to: "ARRIVED",
    roles: ["PENGEPUL", "SUPERADMIN"],
    actor: "collector",
  },
  collect: {
    from: ["ARRIVED"],
    to: "COLLECTED",
    roles: ["PENGEPUL", "SUPERADMIN"],
    actor: "collector",
  },
  complete: {
    from: ["COLLECTED"],
    to: "COMPLETED",
    roles: ["PENGEPUL", "SUPERADMIN"],
    actor: "collector",
  },
  fail: {
    from: ["ASSIGNED", "ON_THE_WAY", "ARRIVED", "COLLECTED"],
    to: "FAILED",
    roles: ["PENGEPUL", "SUPERADMIN"],
    actor: "collector",
  },
  cancel: {
    // Not COLLECTED: loaded material is completed or failed by the collector.
    from: ["REQUESTED", "ASSIGNED", "ON_THE_WAY", "ARRIVED"],
    to: "CANCELLED",
    roles: ["ADMIN", "SUPERADMIN"],
    actor: "admin",
  },
};

/** Roles that may ever take `action` (ownership and status are checked separately). */
export function pickupActionRoles(action: PickupAction): Role[] {
  return RULES[action]?.roles ?? [];
}

export interface PickupContext {
  status: PickupStatus;
  role: Role;
  isAssignedCollector: boolean;
  isOrgAdmin: boolean;
}

export interface PickupResolution {
  ok: boolean;
  to?: PickupStatus;
  error?: string;
  /** "status": not allowed from the current status (409); "forbidden": wrong role/owner (403). */
  kind?: "status" | "forbidden";
}

export function resolvePickupTransition(
  action: PickupAction,
  ctx: PickupContext,
): PickupResolution {
  const rule = RULES[action];
  if (!rule) return { ok: false, error: "Aksi tidak dikenal", kind: "status" };
  if (!rule.roles.includes(ctx.role)) {
    return { ok: false, error: "Peran tidak diizinkan untuk aksi ini", kind: "forbidden" };
  }
  if (ctx.role !== "SUPERADMIN") {
    if (rule.actor === "collector" && !ctx.isAssignedCollector) {
      return { ok: false, error: "Hanya pengepul yang ditugaskan dapat melakukan aksi ini", kind: "forbidden" };
    }
    if (rule.actor === "admin" && !ctx.isOrgAdmin) {
      return { ok: false, error: "Hanya admin organisasi dapat melakukan aksi ini", kind: "forbidden" };
    }
  }
  if (!rule.from.includes(ctx.status)) {
    return { ok: false, error: `Status ${ctx.status} tidak bisa di-${action}`, kind: "status" };
  }
  return { ok: true, to: rule.to };
}

/** Terminal states where a machine pickup is considered done/closed. */
export const PICKUP_TERMINAL: PickupStatus[] = ["COMPLETED", "CANCELLED", "FAILED"];

export const PICKUP_OPEN: PickupStatus[] = [
  "REQUESTED",
  "ASSIGNED",
  "ON_THE_WAY",
  "ARRIVED",
  "COLLECTED",
];

/** B05: the collector may be (re)assigned only before field work starts. */
export const PICKUP_REASSIGNABLE: PickupStatus[] = ["REQUESTED", "ASSIGNED"];

/** B05: closed without completion; an admin may create one replacement task. */
export const PICKUP_REPLACEABLE: PickupStatus[] = ["FAILED", "CANCELLED"];

/** Fill level (percent) at or above which an auto pickup request is raised. */
export const AUTO_PICKUP_FILL_THRESHOLD = 90;

export interface PickupDispatchView {
  /** The status the next step moves the task to (null when nothing follows). */
  nextStatus: PickupStatus | null;
  /** Who takes the next step. */
  nextActor: "ADMIN" | "COLLECTOR" | null;
  /** Indonesian description of the next step for web and mobile. */
  nextLabel: string;
  /** ASSIGNED and the operator-chosen start deadline has passed. */
  overdue: boolean;
  /** FAILED/CANCELLED without a replacement task yet. */
  needsReplacement: boolean;
}

const NEXT_STEP: Partial<Record<PickupStatus, { nextStatus: PickupStatus; nextActor: "ADMIN" | "COLLECTOR"; nextLabel: string }>> = {
  REQUESTED: { nextStatus: "ASSIGNED", nextActor: "ADMIN", nextLabel: "Menunggu admin menugaskan pengepul" },
  ASSIGNED: { nextStatus: "ON_THE_WAY", nextActor: "COLLECTOR", nextLabel: "Menunggu pengepul berangkat" },
  ON_THE_WAY: { nextStatus: "ARRIVED", nextActor: "COLLECTOR", nextLabel: "Pengepul menuju lokasi" },
  ARRIVED: { nextStatus: "COLLECTED", nextActor: "COLLECTOR", nextLabel: "Pengepul mengambil material" },
  COLLECTED: { nextStatus: "COMPLETED", nextActor: "COLLECTOR", nextLabel: "Pengepul menyelesaikan tugas" },
};

/**
 * Who acts next and whether the task is overdue. Pure (safe in client
 * components); `now` is the caller's clock. A task is overdue only against
 * the deadline the operator chose at dispatch: no deadline, no overdue.
 */
export function describePickupDispatch(
  pickup: {
    status: PickupStatus;
    expectedStartAt: Date | string | null;
    replacedBy?: { id: string } | null;
    replacedById?: string | null;
  },
  now: Date = new Date(),
): PickupDispatchView {
  const step = NEXT_STEP[pickup.status];
  const deadline = pickup.expectedStartAt ? new Date(pickup.expectedStartAt) : null;
  const overdue = pickup.status === "ASSIGNED" && deadline !== null && deadline.getTime() < now.getTime();
  if (step) {
    return {
      ...step,
      nextLabel: overdue ? "Terlambat: pengepul belum berangkat" : step.nextLabel,
      overdue,
      needsReplacement: false,
    };
  }
  const replaced = Boolean(pickup.replacedBy?.id ?? pickup.replacedById);
  const needsReplacement = PICKUP_REPLACEABLE.includes(pickup.status) && !replaced;
  return {
    nextStatus: needsReplacement ? "REQUESTED" : null,
    nextActor: needsReplacement ? "ADMIN" : null,
    nextLabel: needsReplacement
      ? "Menunggu admin membuat tugas pengganti"
      : pickup.status === "COMPLETED"
        ? "Selesai"
        : "Sudah diganti tugas baru",
    overdue: false,
    needsReplacement,
  };
}
