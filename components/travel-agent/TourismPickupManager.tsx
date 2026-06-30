"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, DataTable, StatusBadge, type Column } from "@/components/ui";

export interface TourismPickupRow {
  id: string;
  groupName: string | null;
  campaignName: string;
  organizationName: string;
  travelAgentName: string | null;
  complianceStatus: string;
  complianceScore: number;
  bagCount: number;
  pickedUp: boolean;
}

export function TourismPickupManager({ rows }: { rows: TourismPickupRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pickup(row: TourismPickupRow) {
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch("/api/manual-validations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId: row.id,
          validationStage: "BANK_SAMPAH_PICKUP",
          gateType: "BANK_SAMPAH",
          returnedBagCount: row.bagCount,
          appCompleted: true,
          notes: "Pickup sampah terpilah oleh Bank Sampah",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Gagal mencatat pickup");
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<TourismPickupRow>[] = [
    {
      key: "trip",
      header: "Trip",
      render: (r) => (
        <div>
          <p className="font-medium text-foreground">{r.groupName ?? r.campaignName}</p>
          <p className="text-xs text-muted">
            {r.organizationName} - {r.travelAgentName ?? "Tanpa agent"}
          </p>
        </div>
      ),
    },
    { key: "bags", header: "Tas", render: (r) => `${r.bagCount}` },
    {
      key: "compliance",
      header: "Compliance",
      render: (r) => (
        <div className="space-y-1">
          <StatusBadge status={r.complianceStatus} />
          <p className="text-xs text-muted">{r.complianceScore}/100</p>
        </div>
      ),
    },
    {
      key: "pickup",
      header: "Pickup",
      render: (r) => r.pickedUp ? <StatusBadge status="BANK_SAMPAH_PICKUP" /> : <StatusBadge status="PENDING" />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => (
        <Button size="sm" disabled={r.pickedUp || busyId === r.id} onClick={() => pickup(r)}>
          {busyId === r.id ? "Mencatat..." : "Catat Pickup"}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error">
          {error}
        </div>
      ) : null}
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        emptyTitle="Belum ada pickup wisata"
        emptyDescription="Trip wisata yang sudah check-out akan muncul di sini."
      />
    </div>
  );
}
