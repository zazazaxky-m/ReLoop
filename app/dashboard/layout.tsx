import type { Metadata } from "next";
import { requirePageUser } from "@/lib/rbac";
import { AppShell } from "@/components/AppShell";
import { RealtimeRefresh } from "@/components/realtime/RealtimeRefresh";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requirePageUser();
  return (
    <AppShell
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
        organizationName: user.organizationName,
      }}
    >
      <RealtimeRefresh />
      {children}
    </AppShell>
  );
}
