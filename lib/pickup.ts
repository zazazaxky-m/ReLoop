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
 * Pickup lifecycle:
 * REQUESTED -> ASSIGNED -> ON_THE_WAY -> ARRIVED -> COLLECTED -> COMPLETED
 * with FAILED/CANCELLED escape hatches. Admin assigns + cancels; the assigned
 * collector drives the field statuses.
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
    from: ["REQUESTED", "ASSIGNED"],
    to: "CANCELLED",
    roles: ["ADMIN", "SUPERADMIN"],
    actor: "admin",
  },
};

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
}

export function resolvePickupTransition(
  action: PickupAction,
  ctx: PickupContext,
): PickupResolution {
  const rule = RULES[action];
  if (!rule) return { ok: false, error: "Aksi tidak dikenal" };
  if (!rule.from.includes(ctx.status)) {
    return { ok: false, error: `Status ${ctx.status} tidak bisa di-${action}` };
  }
  if (!rule.roles.includes(ctx.role)) {
    return { ok: false, error: "Peran tidak diizinkan untuk aksi ini" };
  }
  if (ctx.role !== "SUPERADMIN") {
    if (rule.actor === "collector" && !ctx.isAssignedCollector) {
      return { ok: false, error: "Hanya pengepul yang ditugaskan dapat melakukan aksi ini" };
    }
    if (rule.actor === "admin" && !ctx.isOrgAdmin) {
      return { ok: false, error: "Hanya admin organisasi dapat melakukan aksi ini" };
    }
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

/** Fill level (percent) at or above which an auto pickup request is raised. */
export const AUTO_PICKUP_FILL_THRESHOLD = 90;
