import type { Metadata } from "next";
import { requirePageUser } from "@/lib/rbac";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function MapLayout({
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
      {children}
    </AppShell>
  );
}
