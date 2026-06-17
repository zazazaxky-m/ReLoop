import { requirePageUser } from "@/lib/rbac";
import { Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui";

export default async function PengepulProfilePage() {
  const user = await requirePageUser(["PENGEPUL"]);
  return (
    <div className="space-y-6">
      <PageHeader title="Profil Pengepul" />
      <Card>
        <CardHeader>
          <CardTitle>{user.name}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <p>Email: {user.email}</p>
          {user.phone ? <p>Telepon: {user.phone}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
