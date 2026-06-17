import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { readSessionToken, verifySessionToken } from "./auth";
import { dashboardPath, type AppRole } from "./roles";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: AppRole;
  organizationId: string | null;
  organizationName: string | null;
  payoutEligible: boolean;
  status: string;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Resolves the current user from the session cookie + DB (fresh role/org). */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = await readSessionToken();
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: { organization: { select: { name: true } } },
  });
  if (!user || user.status !== "ACTIVE") return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role as AppRole,
    organizationId: user.organizationId,
    organizationName: user.organization?.name ?? null,
    payoutEligible: user.payoutEligible,
    status: user.status,
  };
}

// ---------- Page guards (redirect-based) ----------

export async function requirePageUser(roles?: AppRole[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect(dashboardPath(user.role));
  return user;
}

// ---------- API guards (throw HttpError) ----------

export async function requireApiUser(roles?: AppRole[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "Tidak terautentikasi");
  if (roles && !roles.includes(user.role)) {
    throw new HttpError(403, "Akses ditolak untuk peran ini");
  }
  return user;
}

/** Admins are limited to their own organization; superadmin sees all. */
export function assertOrgScope(user: CurrentUser, organizationId: string): void {
  if (user.role === "SUPERADMIN") return;
  if (user.role === "ADMIN" && user.organizationId === organizationId) return;
  throw new HttpError(403, "Di luar scope organisasi Anda");
}

/**
 * A collector may only operate on an organization where they have an ACTIVE
 * partnership. Returns the partnership row.
 */
export async function assertActivePartnership(
  collectorUserId: string,
  organizationId: string,
) {
  const partner = await prisma.organizationCollectorPartner.findFirst({
    where: { collectorUserId, organizationId, status: "ACTIVE" },
  });
  if (!partner) {
    throw new HttpError(403, "Kemitraan pengepul belum aktif untuk organisasi ini");
  }
  return partner;
}

/** Org IDs where the given collector has an ACTIVE partnership. */
export async function activePartnerOrgIds(
  collectorUserId: string,
): Promise<string[]> {
  const rows = await prisma.organizationCollectorPartner.findMany({
    where: { collectorUserId, status: "ACTIVE" },
    select: { organizationId: true },
  });
  return rows.map((r) => r.organizationId);
}
