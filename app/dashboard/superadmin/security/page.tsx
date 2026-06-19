import type { Metadata } from "next";
import { MetricCard, PageHeader } from "@/components/ui";
import { AlertTriangle, Recycle, ShieldCheck } from "@/components/ui/icons";
import { SecurityEventList } from "@/components/security/SecurityEventList";
import { requirePageUser } from "@/lib/rbac";
import { getSecurityEvents, getSecuritySummary } from "@/lib/security-events";

export const metadata: Metadata = { title: "Log Keamanan" };
export const dynamic = "force-dynamic";

export default async function SecurityLogPage() {
  await requirePageUser(["SUPERADMIN"]);
  const [summary, events] = await Promise.all([
    getSecuritySummary(),
    getSecurityEvents({ take: 150 }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Log Keamanan"
        description="Pantau indikasi fraud, vandalisme, dan safe-state dari seluruh mesin secara real-time."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Alert 24 jam"
          value={summary.alerts24h}
          icon={AlertTriangle}
          tone="amber"
        />
        <MetricCard label="Fraud 7 hari" value={summary.fraud7d} icon={ShieldCheck} tone="amber" />
        <MetricCard label="Vandalisme 7 hari" value={summary.vandalism7d} icon={AlertTriangle} tone="slate" />
        <MetricCard label="Mesin terdampak" value={summary.affectedMachines7d} icon={Recycle} tone="teal" />
      </div>

      <SecurityEventList events={events} />
    </div>
  );
}
