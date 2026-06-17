import { requirePageUser } from "@/lib/rbac";
import { Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui";
export default async function UserProfilePage() {
  const user = await requirePageUser(["USER"]);

  return (
    <div className="space-y-6">
      <PageHeader title="Profil" description="Informasi akun Anda." />
      <Card>
        <CardHeader>
          <CardTitle>{user.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="text-muted">Email:</span> {user.email}
          </p>
          {user.phone ? (
            <p>
              <span className="text-muted">Telepon:</span> {user.phone}
            </p>
          ) : null}
          <p>
            <span className="text-muted">Status:</span> {user.status}
          </p>
          <p>
            <span className="text-muted">Payout eligible:</span>{" "}
            {user.payoutEligible ? "Ya" : "Tidak"}
          </p>
          <p className="text-xs text-muted-soft">
            KYC tidak diperlukan pada MVP.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
