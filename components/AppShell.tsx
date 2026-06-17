"use client";

import { useState, type ComponentType, type SVGProps } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { ROLE_LABELS, type AppRole } from "@/lib/roles";
import {
  Building,
  FileText,
  LayoutDashboard,
  LogOut,
  Map,
  MapPin,
  Megaphone,
  Menu,
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

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

interface NavItem {
  label: string;
  href: string;
  icon: IconType;
  exact?: boolean;
  primary?: boolean; // shown in mobile bottom bar
}

const NAV: Record<AppRole, NavItem[]> = {
  USER: [
    { label: "Dashboard", href: "/dashboard/user", icon: LayoutDashboard, exact: true, primary: true },
    { label: "Scan Mesin", href: "/scan", icon: QrCode, primary: true },
    { label: "Peta", href: "/map", icon: Map, primary: true },
    { label: "Dompet", href: "/dashboard/user/wallet", icon: Wallet, primary: true },
    { label: "Campaign", href: "/dashboard/user/campaigns", icon: Megaphone, primary: true },
    { label: "Trash Bag", href: "/dashboard/user/trash-bag", icon: Trash },
    { label: "Profil", href: "/dashboard/user/profile", icon: User },
  ],
  PENGEPUL: [
    { label: "Dashboard", href: "/dashboard/pengepul", icon: LayoutDashboard, exact: true, primary: true },
    { label: "Tugas Pickup", href: "/dashboard/pengepul/tasks", icon: Truck, primary: true },
    { label: "Peta Mesin", href: "/dashboard/pengepul/map", icon: Map, primary: true },
    { label: "Area Layanan", href: "/dashboard/pengepul/area", icon: MapPin, primary: true },
    { label: "Profil", href: "/dashboard/pengepul/profile", icon: User, primary: true },
  ],
  ADMIN: [
    { label: "Dashboard", href: "/dashboard/admin", icon: LayoutDashboard, exact: true },
    { label: "Mesin", href: "/dashboard/admin/machines", icon: Recycle },
    { label: "Campaign", href: "/dashboard/admin/campaigns", icon: Megaphone },
    { label: "Jenis Sampah & Tarif", href: "/dashboard/admin/waste-types", icon: Trash },
    { label: "Pickup", href: "/dashboard/admin/pickups", icon: Truck },
    { label: "Mitra Pengepul", href: "/dashboard/admin/partners", icon: Users },
    { label: "Trip / Trash Bag", href: "/dashboard/admin/trips", icon: Trash },
    { label: "Laporan", href: "/dashboard/admin/reports", icon: FileText },
  ],
  SUPERADMIN: [
    { label: "Dashboard", href: "/dashboard/superadmin", icon: LayoutDashboard, exact: true },
    { label: "Organisasi", href: "/dashboard/superadmin/organizations", icon: Building },
    { label: "Mesin", href: "/dashboard/superadmin/machines", icon: Recycle },
    { label: "Pengguna", href: "/dashboard/superadmin/users", icon: Users },
    { label: "Kemitraan", href: "/dashboard/superadmin/partnerships", icon: ShieldCheck },
    { label: "Redemption", href: "/dashboard/superadmin/redemptions", icon: Wallet },
    { label: "Wilayah", href: "/dashboard/superadmin/regions", icon: Map },
    { label: "Jenis Sampah & Tarif", href: "/dashboard/superadmin/waste-types", icon: Trash },
    { label: "Konfigurasi", href: "/dashboard/superadmin/config", icon: Settings },
    { label: "Audit Log", href: "/dashboard/superadmin/audit", icon: FileText },
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

function Brand({ subtitle }: { subtitle?: string }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-lg text-white">
        <Recycle />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-base font-bold text-foreground">ReLoop</span>
        <span className="text-[11px] font-medium text-muted">
          {subtitle ?? "Smart Waste Bank"}
        </span>
      </span>
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const items = NAV[user.role] ?? [];
  const primaryItems = items.filter((i) => i.primary).slice(0, 5);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const navLinks = (onNavigate?: () => void) =>
    items.map((item) => {
      const active = isActive(pathname, item);
      const Icon = item.icon;
      return (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
            active
              ? "bg-brand-500 text-white shadow-sm"
              : "text-slate-600 hover:bg-brand-50 hover:text-brand-700",
          )}
        >
          <Icon className="text-lg" />
          {item.label}
        </Link>
      );
    });

  const userFooter = (
    <div className="flex items-center gap-3 border-t border-border px-2 py-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-mint text-sm font-semibold text-brand-700">
        {user.name.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">
          {user.name}
        </p>
        <p className="truncate text-xs text-muted">{ROLE_LABELS[user.role]}</p>
      </div>
      <button
        onClick={logout}
        title="Keluar"
        className="flex h-9 w-9 items-center justify-center rounded-xl text-muted transition-colors hover:bg-red-50 hover:text-status-error"
      >
        <LogOut className="text-lg" />
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-surface lg:flex">
        <div className="px-5 py-5">
          <Brand subtitle={user.organizationName ?? "Smart Waste Bank"} />
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {navLinks()}
        </nav>
        {userFooter}
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
        <Brand subtitle={user.organizationName ?? undefined} />
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-border text-foreground"
          aria-label="Buka menu"
        >
          <Menu className="text-xl" />
        </button>
      </header>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-surface shadow-xl">
            <div className="flex items-center justify-between px-5 py-4">
              <Brand subtitle={user.organizationName ?? undefined} />
              <button
                onClick={() => setDrawerOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-xl text-muted"
                aria-label="Tutup menu"
              >
                <X className="text-lg" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
              {navLinks(() => setDrawerOpen(false))}
            </nav>
            {userFooter}
          </div>
        </div>
      ) : null}

      {/* Content */}
      <div className="lg:pl-64">
        <main className="mx-auto w-full max-w-6xl px-4 py-6 pb-24 sm:px-6 lg:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav (USER & PENGEPUL) */}
      {primaryItems.length > 0 ? (
        <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface/95 backdrop-blur lg:hidden">
          {primaryItems.map((item) => {
            const active = isActive(pathname, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
                  active ? "text-brand-600" : "text-muted",
                )}
              >
                <Icon className="text-xl" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
