import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { MfaManager } from "@/components/security/MfaManager";
import { requirePageUser } from "@/lib/rbac";

export const metadata: Metadata = { title: "Keamanan Akun" };

export default async function AdminSecurityPage() {
  await requirePageUser(["ADMIN"]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Keamanan Akun"
        description="Kelola autentikasi dua faktor (MFA) untuk melindungi akses dashboard admin."
      />
      <MfaManager />
    </div>
  );
}
