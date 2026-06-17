import type { PartnerStatus, Role } from "@prisma/client";

export type PartnershipAction =
  | "accept"
  | "decline"
  | "approve"
  | "reject"
  | "suspend"
  | "reactivate"
  | "remove";

interface TransitionRule {
  from: PartnerStatus[];
  to: PartnerStatus;
  /** Roles allowed to perform this action (ownership enforced separately). */
  roles: Role[];
  /** "collector" or "admin" must own the row, in addition to role match. */
  owner?: "collector" | "admin" | "any";
}

/**
 * Partnership lifecycle. The critical invariant: a partnership only becomes
 * ACTIVE through superadmin `approve`. Admin invites and collector requests
 * both funnel into PENDING_SUPERADMIN_APPROVAL first.
 */
const RULES: Record<PartnershipAction, TransitionRule[]> = {
  // Collector accepts an admin invite; admin accepts a collector request.
  accept: [
    { from: ["INVITED"], to: "PENDING_SUPERADMIN_APPROVAL", roles: ["PENGEPUL"], owner: "collector" },
    { from: ["REQUESTED"], to: "PENDING_SUPERADMIN_APPROVAL", roles: ["ADMIN"], owner: "admin" },
  ],
  decline: [
    { from: ["INVITED"], to: "REJECTED", roles: ["PENGEPUL"], owner: "collector" },
    { from: ["REQUESTED"], to: "REJECTED", roles: ["ADMIN"], owner: "admin" },
  ],
  approve: [
    { from: ["PENDING_SUPERADMIN_APPROVAL"], to: "ACTIVE", roles: ["SUPERADMIN"], owner: "any" },
  ],
  reject: [
    { from: ["PENDING_SUPERADMIN_APPROVAL"], to: "REJECTED", roles: ["SUPERADMIN"], owner: "any" },
  ],
  suspend: [
    { from: ["ACTIVE"], to: "SUSPENDED", roles: ["ADMIN", "SUPERADMIN"], owner: "admin" },
  ],
  reactivate: [
    { from: ["SUSPENDED"], to: "ACTIVE", roles: ["ADMIN", "SUPERADMIN"], owner: "admin" },
  ],
  remove: [
    {
      from: ["INVITED", "REQUESTED", "PENDING_SUPERADMIN_APPROVAL", "ACTIVE", "SUSPENDED", "REJECTED"],
      to: "REMOVED",
      roles: ["ADMIN", "SUPERADMIN"],
      owner: "admin",
    },
  ],
};

export interface PartnershipContext {
  status: PartnerStatus;
  role: Role;
  /** True when the actor is the collector on this partnership. */
  isCollector: boolean;
  /** True when the actor is an admin of the partnership's organization. */
  isOrgAdmin: boolean;
}

export interface PartnershipResolution {
  ok: boolean;
  to?: PartnerStatus;
  error?: string;
}

export function resolvePartnershipTransition(
  action: PartnershipAction,
  ctx: PartnershipContext,
): PartnershipResolution {
  const rules = RULES[action];
  if (!rules) return { ok: false, error: "Aksi tidak dikenal" };

  for (const rule of rules) {
    if (!rule.from.includes(ctx.status)) continue;
    if (!rule.roles.includes(ctx.role)) continue;

    if (ctx.role !== "SUPERADMIN") {
      if (rule.owner === "collector" && !ctx.isCollector) continue;
      if (rule.owner === "admin" && !ctx.isOrgAdmin) continue;
    }
    return { ok: true, to: rule.to };
  }

  return {
    ok: false,
    error: `Transisi kemitraan tidak diizinkan: ${action} dari ${ctx.status}`,
  };
}

export function isPartnershipActive(status: PartnerStatus): boolean {
  return status === "ACTIVE";
}
