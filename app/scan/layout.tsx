import { requirePageUser } from "@/lib/rbac";
import { AppShell } from "@/components/AppShell";

export default async function ScanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requirePageUser(["USER"]);
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
