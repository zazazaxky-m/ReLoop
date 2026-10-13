import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { EmailVerificationCard } from "@/components/profile/EmailVerificationCard";

export default async function UserProfilePage() {
  const user = await requirePageUser(["USER"]);
  const [account, memberships] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { emailVerifiedAt: true } }),
    prisma.travelAgentUser.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { travelAgentId: true, verifiedAt: true, travelAgent: { select: { name: true } } },
    }),
  ]);
  const emailVerified = Boolean(account?.emailVerifiedAt);

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
      <EmailVerificationCard
        emailVerified={emailVerified}
        memberships={memberships.map((m) => ({
          travelAgentId: m.travelAgentId,
          travelAgentName: m.travelAgent.name,
          verified: Boolean(m.verifiedAt) && emailVerified,
        }))}
      />
    </div>
  );
}
