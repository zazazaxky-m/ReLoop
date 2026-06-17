import type { Metadata } from "next";
import { requirePageUser } from "@/lib/rbac";
import { getAllConfig, CONFIG_KEYS } from "@/lib/config";
import { PageHeader } from "@/components/ui";
import { ConfigEditor } from "@/components/admin/ConfigEditor";

export const metadata: Metadata = { title: "Konfigurasi Global" };

export default async function SuperadminConfigPage() {
  await requirePageUser(["SUPERADMIN"]);
  const config = await getAllConfig();

  const initial = {
    minRedemption: parseInt(config[CONFIG_KEYS.MIN_REDEMPTION] ?? "10000", 10),
    qrRotation: parseInt(config[CONFIG_KEYS.DEFAULT_QR_ROTATION_SECONDS] ?? "30", 10),
    pointsToRupiah: parseInt(config[CONFIG_KEYS.POINTS_TO_RUPIAH] ?? "1", 10),
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Konfigurasi Global"
        description="Atur minimum redemption, rotasi QR, dan konversi poin. Berlaku lintas platform."
      />
      <ConfigEditor initial={initial} />
    </div>
  );
}
