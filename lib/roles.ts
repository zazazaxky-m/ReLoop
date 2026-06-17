// Client-safe role helpers (no Prisma import so this can be used in client components).
export type AppRole = "SUPERADMIN" | "ADMIN" | "PENGEPUL" | "USER";

export const ROLE_LABELS: Record<AppRole, string> = {
  SUPERADMIN: "Superadmin",
  ADMIN: "Admin Organisasi",
  PENGEPUL: "Pengepul",
  USER: "Pengguna",
};

export function dashboardPath(role: AppRole): string {
  return `/dashboard/${role.toLowerCase()}`;
}
