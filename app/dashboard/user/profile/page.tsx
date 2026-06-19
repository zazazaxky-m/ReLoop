import { requirePageUser } from "@/lib/rbac";
import { Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui";
export default async function UserProfilePage() {
  const user = await requirePageUser(["USER"]);

  return (
    <div className="space-y-6">
      <PageHeader title="Profil" description="Lihat informasi dasar dan status akun Anda." />
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
            <span className="text-muted">Dapat melakukan pencairan:</span>{" "}
            {user.payoutEligible ? "Ya" : "Tidak"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
