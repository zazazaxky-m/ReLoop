import { requirePageUser } from "@/lib/rbac";
import { AppShell } from "@/components/AppShell";

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
      {children}
    </AppShell>
  );
}
