"use client";

import {
  useEffect,
  useState,
  type ComponentType,
  type SVGProps,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { ROLE_LABELS, type AppRole } from "@/lib/roles";
import {
  Building,
  AlertTriangle,
  FileText,
  LayoutDashboard,
  LogOut,
  Map,
  MapPin,
  Megaphone,
  MoreHorizontal,
  QrCode,
  Recycle,
  Settings,
  ShieldCheck,
  Trash,
  Truck,
  User,
  Users,
  Wallet,
  X,
} from "@/components/ui/icons";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { NotificationBell } from "@/components/notifications/NotificationBell";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

interface NavItem {
  label: string;
  href: string;
  icon: IconType;
  group: "Utama" | "Operasional" | "Manajemen";
  mobileLabel?: string;
  exact?: boolean;
  primary?: boolean;
  emphasis?: boolean;
}

const NAV: Record<AppRole, NavItem[]> = {
  USER: [
    { label: "Dashboard", href: "/dashboard/user", icon: LayoutDashboard, group: "Utama", exact: true, primary: true },
    { label: "Scan Mesin", mobileLabel: "Scan", href: "/scan", icon: QrCode, group: "Utama", primary: true, emphasis: true },
    { label: "Peta", href: "/map", icon: Map, group: "Utama", primary: true },
    { label: "Dompet", href: "/dashboard/user/wallet", icon: Wallet, group: "Operasional", primary: true },
    { label: "Campaign", mobileLabel: "Program", href: "/dashboard/user/campaigns", icon: Megaphone, group: "Operasional" },
    { label: "Trash Bag", mobileLabel: "Kantong", href: "/dashboard/user/trash-bag", icon: Trash, group: "Operasional" },
    { label: "Profil", href: "/dashboard/user/profile", icon: User, group: "Manajemen" },
  ],
  PENGEPUL: [
    { label: "Dashboard", href: "/dashboard/pengepul", icon: LayoutDashboard, group: "Utama", exact: true, primary: true },
    { label: "Tugas Pickup", mobileLabel: "Tugas", href: "/dashboard/pengepul/tasks", icon: Truck, group: "Utama", primary: true, emphasis: true },
    { label: "Pickup Wisata", mobileLabel: "Wisata", href: "/dashboard/pengepul/tourism-pickups", icon: Trash, group: "Utama", primary: true },
    { label: "Peta Mesin", mobileLabel: "Peta", href: "/dashboard/pengepul/map", icon: Map, group: "Operasional", primary: true },
    { label: "Area Layanan", mobileLabel: "Area", href: "/dashboard/pengepul/area", icon: MapPin, group: "Operasional", primary: true },
    { label: "Profil", href: "/dashboard/pengepul/profile", icon: User, group: "Manajemen" },
  ],
  ADMIN: [
    { label: "Dashboard", href: "/dashboard/admin", icon: LayoutDashboard, group: "Utama", exact: true, primary: true },
    { label: "Mesin", href: "/dashboard/admin/machines", icon: Recycle, group: "Utama", primary: true },
    { label: "Pickup", href: "/dashboard/admin/pickups", icon: Truck, group: "Operasional", primary: true },
    { label: "Campaign", mobileLabel: "Program", href: "/dashboard/admin/campaigns", icon: Megaphone, group: "Operasional" },
    { label: "Jenis Sampah & Tarif", mobileLabel: "Jenis", href: "/dashboard/admin/waste-types", icon: Trash, group: "Operasional" },
    { label: "Mitra Pengepul", mobileLabel: "Mitra", href: "/dashboard/admin/partners", icon: Users, group: "Manajemen" },
    { label: "Travel Agent", mobileLabel: "Agent", href: "/dashboard/admin/travel-agents", icon: Users, group: "Manajemen" },
    { label: "Trip / Trash Bag", mobileLabel: "Trip", href: "/dashboard/admin/trips", icon: Trash, group: "Manajemen" },
    { label: "Compliance", mobileLabel: "Patuh", href: "/dashboard/admin/compliance", icon: ShieldCheck, group: "Manajemen" },
    { label: "Keamanan Akun", mobileLabel: "MFA", href: "/dashboard/admin/security", icon: ShieldCheck, group: "Manajemen" },
    { label: "Laporan", href: "/dashboard/admin/reports", icon: FileText, group: "Manajemen", primary: true },
  ],
  SUPERADMIN: [
    { label: "Dashboard", href: "/dashboard/superadmin", icon: LayoutDashboard, group: "Utama", exact: true, primary: true },
    { label: "Organisasi", href: "/dashboard/superadmin/organizations", icon: Building, group: "Utama", primary: true },
    { label: "Mesin", href: "/dashboard/superadmin/machines", icon: Recycle, group: "Utama", primary: true },
    { label: "Pengguna", href: "/dashboard/superadmin/users", icon: Users, group: "Manajemen", primary: true },
    { label: "Kemitraan", mobileLabel: "Mitra", href: "/dashboard/superadmin/partnerships", icon: ShieldCheck, group: "Operasional" },
    { label: "Redemption", mobileLabel: "Pencairan", href: "/dashboard/superadmin/redemptions", icon: Wallet, group: "Operasional" },
    { label: "Rekonsiliasi", mobileLabel: "Rekonsiliasi", href: "/dashboard/superadmin/reconciliation", icon: Wallet, group: "Operasional" },
    { label: "Log Keamanan", mobileLabel: "Keamanan", href: "/dashboard/superadmin/security", icon: AlertTriangle, group: "Operasional", primary: true },
    { label: "Wilayah", href: "/dashboard/superadmin/regions", icon: Map, group: "Manajemen" },
    { label: "Jenis Sampah & Tarif", mobileLabel: "Jenis", href: "/dashboard/superadmin/waste-types", icon: Trash, group: "Manajemen" },
    { label: "Konfigurasi", mobileLabel: "Config", href: "/dashboard/superadmin/config", icon: Settings, group: "Manajemen" },
    { label: "Keamanan Akun", mobileLabel: "MFA", href: "/dashboard/superadmin/account-security", icon: ShieldCheck, group: "Manajemen" },
    { label: "Audit Log", mobileLabel: "Audit", href: "/dashboard/superadmin/audit", icon: FileText, group: "Manajemen" },
  ],
};

export interface AppShellUser {
  name: string;
  email: string;
  role: AppRole;
  organizationName?: string | null;
}

function isActive(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center">
      <Image
        src={compact ? "/reloop-logo.svg" : "/reloop-logo-name.svg"}
        alt="ReLoop"
        width={compact ? 40 : 128}
        height={40}
        className={compact ? "h-9 w-9" : "h-10 w-auto"}
      />
    </Link>
  );
}

export function AppShell({
  user,
  children,
}: {
  user: AppShellUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const items = NAV[user.role] ?? [];
  const currentItem =
    items.find((item) => isActive(pathname, item)) ?? items[0];
  const CurrentIcon = currentItem?.icon;
  const [moreOpen, setMoreOpen] = useState(false);

  // Mobile bottom bar shows a small set of primary destinations; the rest live
  // in the "Lainnya" sheet so the tab bar never needs horizontal scrolling.
  const primaryItems = items.filter((item) => item.primary);
  const overflowItems = items.filter((item) => !item.primary);
  const overflowActive = overflowItems.some((item) => isActive(pathname, item));

  useEffect(() => {
    document.body.style.overflow = moreOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [moreOpen]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const navLinks = (
    onNavigate?: () => void,
    variant: "desktop" | "mobile" = "desktop",
  ) =>
    (["Utama", "Operasional", "Manajemen"] as const).map((group) => {
      const groupItems = items.filter((item) => item.group === group);
      if (groupItems.length === 0) return null;
      return (
        <div key={group} className="space-y-1">
          <p
            className={cn(
              "px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-soft",
              variant === "mobile" ? "pt-2" : "pt-3",
            )}
          >
            {group}
          </p>
          {groupItems.map((item) => {
            const active = isActive(pathname, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "group relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                  active && variant === "mobile"
                    ? "bg-brand-600 text-white shadow-sm"
                    : active
                      ? "bg-brand-50 text-brand-800 dark:bg-brand-950/20 dark:text-brand-400"
                      : "text-muted hover:bg-surface-soft hover:text-foreground",
                )}
              >
                {active && variant === "desktop" ? (
                  <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-brand-500" />
                ) : null}
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
                    active && variant === "mobile"
                      ? "bg-white/15 text-white"
                      : active
                        ? "bg-brand-600 text-white"
                      : "bg-surface-soft text-muted-soft group-hover:bg-surface group-hover:text-brand-700",
                  )}
                >
                  <Icon className="text-base" />
                </span>
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      );
    });

  const userFooter = (
    <div className="flex items-center gap-3 border-t border-border px-2 py-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-sm font-semibold text-white dark:bg-brand-950 dark:text-brand-300 border border-transparent dark:border-brand-900/30">
        {user.name.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {user.name}
        </p>
        <p className="truncate text-xs text-muted">{user.email}</p>
      </div>
      <button
        onClick={logout}
        title="Keluar"
        aria-label="Keluar"
        className="flex h-10 w-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-red-50 hover:text-status-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface dark:hover:bg-red-950/20"
      >
        <LogOut className="text-lg" />
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-18 items-center border-b border-border px-6">
          <Brand />
        </div>
        {user.organizationName ? (
          <div className="border-b border-border bg-surface-soft px-5 py-3.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-soft">
              Organisasi aktif
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-foreground">
              {user.organizationName}
            </p>
          </div>
        ) : null}
        <nav className="flex-1 overflow-y-auto px-3 pb-5 pt-1">
          {navLinks()}
        </nav>
        <div className="px-3">{userFooter}</div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 hidden h-18 items-center justify-between border-b border-border bg-surface/95 px-8 backdrop-blur lg:flex">
          <div className="flex min-w-0 items-center gap-3">
            {CurrentIcon ? (
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-950/20 dark:text-brand-400">
                <CurrentIcon className="text-lg" />
              </span>
            ) : null}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {currentItem?.label ?? "ReLoop"}
              </p>
              <p className="truncate text-xs text-muted">
                {user.organizationName ?? "Pengelolaan sistem ReLoop"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <ThemeToggle />
            <span className="rounded-md border border-border bg-surface-soft px-2.5 py-1.5 text-xs font-semibold text-muted">
              {ROLE_LABELS[user.role]}
            </span>
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white dark:bg-brand-950 dark:text-brand-300 border border-transparent dark:border-brand-900/30">
              {user.name.charAt(0).toUpperCase()}
            </span>
          </div>
        </header>

        <header className="sticky top-0 z-[800] flex h-16 items-center justify-between border-b border-border bg-surface/95 px-4 backdrop-blur lg:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <Brand compact />
            <div className="min-w-0 border-l border-border pl-3">
              <p className="truncate text-sm font-bold text-foreground">
                {currentItem?.label ?? "ReLoop"}
              </p>
              <p className="truncate text-[11px] text-muted">
                {ROLE_LABELS[user.role]}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <ThemeToggle />
            <button
              onClick={logout}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted shadow-sm hover:bg-red-50 hover:text-status-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface dark:hover:bg-red-950/20"
              aria-label="Keluar"
              title="Keluar"
            >
              <LogOut className="text-lg" />
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-5 pb-28 sm:px-6 sm:py-7 lg:px-8 lg:pb-10">
          {children}
        </main>
      </div>

      {moreOpen ? (
        <div className="fixed inset-0 z-[950] lg:hidden">
          <button
            type="button"
            aria-label="Tutup menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-10px_40px_rgba(15,23,42,0.18)]">
            <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface px-5 py-3.5">
              <p className="text-sm font-bold text-foreground">Menu lainnya</p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Tutup menu"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <X className="text-lg" />
              </button>
            </div>
            <div className="space-y-3 px-3 py-4">
              {navLinks(() => setMoreOpen(false), "mobile")}
            </div>
          </div>
        </div>
      ) : null}

      <nav
        aria-label="Navigasi utama"
        className="fixed inset-x-0 bottom-0 z-[900] border-t border-border bg-surface/95 px-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-6px_20px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden"
      >
        <div className="mx-auto flex max-w-lg items-stretch justify-around gap-0.5">
          {primaryItems.map((item) => {
            const active = isActive(pathname, item);
            const Icon = item.icon;
            if (item.emphasis) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={item.label}
                  className="relative flex min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-lg px-0.5 pb-0.5 text-[10px] font-bold text-brand-700 focus-visible:outline-none dark:text-brand-400"
                >
                  <span className="-mt-6 flex h-13 w-13 items-center justify-center rounded-2xl bg-brand-600 text-2xl text-white shadow-[0_8px_20px_rgba(21,128,61,0.35)] ring-4 ring-surface transition-colors hover:bg-brand-700">
                    <Icon />
                  </span>
                  <span className="max-w-full truncate">
                    {item.mobileLabel ?? item.label}
                  </span>
                </Link>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-0.5 py-1.5 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
                  active ? "text-brand-700 dark:text-brand-400" : "text-muted",
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg text-lg",
                    active ? "bg-brand-50 dark:bg-brand-950/30" : "",
                  )}
                >
                  <Icon />
                </span>
                {active ? (
                  <span className="absolute -top-0.5 h-0.5 w-8 rounded-full bg-brand-500" />
                ) : null}
                <span className="max-w-full truncate">
                  {item.mobileLabel ?? item.label}
                </span>
              </Link>
            );
          })}

          {overflowItems.length > 0 ? (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={cn(
                "relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-0.5 py-1.5 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
                overflowActive ? "text-brand-700 dark:text-brand-400" : "text-muted",
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg text-lg",
                  overflowActive ? "bg-brand-50 dark:bg-brand-950/30" : "",
                )}
              >
                <MoreHorizontal />
              </span>
              <span>Lainnya</span>
            </button>
          ) : null}
        </div>
      </nav>
    </div>
  );
}
