"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  FormField,
  Input,
  Select,
  StatusBadge,
  type Column,
} from "@/components/ui";
import { Plus } from "@/components/ui/icons";

interface Option {
  id: string;
  name: string;
}

export interface TripRow {
  id: string;
  campaignName: string;
  groupName: string | null;
  leaderName: string | null;
  status: string;
  bagCount: number;
  validationCount: number;
  hasUser: boolean;
}

const EMPTY = {
  campaignId: "",
  groupName: "",
  leaderName: "",
  leaderContact: "",
  participantCount: "1",
  userEmail: "",
};

export function TripManager({
  trips,
  campaigns,
}: {
  trips: TripRow[];
  campaigns: Option[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY, campaignId: campaigns[0]?.id ?? "" });

  const [bagTripId, setBagTripId] = useState<string | null>(null);
  const [bagCount, setBagCount] = useState("5");
  const [issuedQrs, setIssuedQrs] = useState<string[]>([]);

  const [valTripId, setValTripId] = useState<string | null>(null);
  const [val, setVal] = useState({
    bagQrCode: "",
    returnedBagCount: "",
    actualWeightKg: "",
    conditionStatus: "GOOD",
    notes: "",
  });

  async function createTrip(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: form.campaignId,
          groupName: form.groupName || undefined,
          leaderName: form.leaderName || undefined,
          leaderContact: form.leaderContact || undefined,
          participantCount: Number(form.participantCount) || 1,
          userEmail: form.userEmail || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d?.error ?? "Gagal membuat trip");
        return;
      }
      setForm({ ...EMPTY, campaignId: campaigns[0]?.id ?? "" });
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function assignBags(tripId: string) {
    setBusy(true);
    setError(null);
    setIssuedQrs([]);
    try {
      const res = await fetch("/api/trash-bags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId, bagCount: Number(bagCount) || 1 }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d?.error ?? "Gagal membuat trash bag");
        return;
      }
      setIssuedQrs((d.bags ?? []).map((b: { bagQrCode: string }) => b.bagQrCode));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function submitValidation(tripId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/manual-validations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId,
          bagQrCode: val.bagQrCode || undefined,
          returnedBagCount: Number(val.returnedBagCount) || 0,
          actualWeightKg: val.actualWeightKg ? Number(val.actualWeightKg) : undefined,
          conditionStatus: val.conditionStatus,
          notes: val.notes || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d?.error ?? "Gagal validasi");
        return;
      }
      setValTripId(null);
      setVal({ bagQrCode: "", returnedBagCount: "", actualWeightKg: "", conditionStatus: "GOOD", notes: "" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<TripRow>[] = [
    {
      key: "trip",
      header: "Trip",
      render: (r) => (
        <div>
          <p className="font-medium text-foreground">{r.groupName ?? r.campaignName}</p>
          <p className="text-xs text-muted">
            {r.campaignName}
            {r.leaderName ? ` · ${r.leaderName}` : ""}
            {r.hasUser ? " · reward ke user" : ""}
          </p>
        </div>
      ),
    },
    { key: "bags", header: "Tas", render: (r) => `${r.bagCount}` },
    { key: "validations", header: "Validasi", render: (r) => `${r.validationCount}` },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => (
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setBagTripId(bagTripId === r.id ? null : r.id);
              setValTripId(null);
              setIssuedQrs([]);
            }}
          >
            Tas
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setValTripId(valTripId === r.id ? null : r.id);
              setBagTripId(null);
            }}
          >
            Validasi
          </Button>
          {r.bagCount > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open(`/print/trips/${r.id}`, "_blank")}
            >
              Print
            </Button>
          ) : null}
        </div>
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

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Trip & Trash Bag</h2>
        <Button
          variant={open ? "outline" : "primary"}
          disabled={campaigns.length === 0}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Tutup" : <><Plus /> Buat Trip</>}
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <p className="text-sm text-muted">
          Buat campaign (tipe Trash Bag / Wisata) terlebih dahulu untuk membuat trip.
        </p>
      ) : null}

      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>Trip Baru</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createTrip} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Campaign" htmlFor="t-campaign" required>
                  <Select
                    id="t-campaign"
                    value={form.campaignId}
                    onChange={(e) => setForm((f) => ({ ...f, campaignId: e.target.value }))}
                  >
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Nama grup" htmlFor="t-group">
                  <Input
                    id="t-group"
                    value={form.groupName}
                    onChange={(e) => setForm((f) => ({ ...f, groupName: e.target.value }))}
                    placeholder="Rombongan Wisata A"
                  />
                </FormField>
                <FormField label="Ketua / leader" htmlFor="t-leader">
                  <Input
                    id="t-leader"
                    value={form.leaderName}
                    onChange={(e) => setForm((f) => ({ ...f, leaderName: e.target.value }))}
                  />
                </FormField>
                <FormField label="Kontak leader" htmlFor="t-contact">
                  <Input
                    id="t-contact"
                    value={form.leaderContact}
                    onChange={(e) => setForm((f) => ({ ...f, leaderContact: e.target.value }))}
                  />
                </FormField>
                <FormField label="Jumlah peserta" htmlFor="t-count">
                  <Input
                    id="t-count"
                    type="number"
                    min={1}
                    value={form.participantCount}
                    onChange={(e) => setForm((f) => ({ ...f, participantCount: e.target.value }))}
                  />
                </FormField>
                <FormField label="Email user (opsional)" htmlFor="t-user" hint="Reward validasi masuk ke user ini">
                  <Input
                    id="t-user"
                    type="email"
                    value={form.userEmail}
                    onChange={(e) => setForm((f) => ({ ...f, userEmail: e.target.value }))}
                  />
                </FormField>
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? "Menyimpan..." : "Buat Trip"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {bagTripId ? (
        <Card>
          <CardHeader>
            <CardTitle>Terbitkan Trash Bag (QR unik)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <FormField label="Jumlah tas" htmlFor="bag-count" className="w-32">
                <Input
                  id="bag-count"
                  type="number"
                  min={1}
                  value={bagCount}
                  onChange={(e) => setBagCount(e.target.value)}
                />
              </FormField>
              <Button disabled={busy} onClick={() => assignBags(bagTripId)}>
                Terbitkan
              </Button>
              <Button
                variant="secondary"
                onClick={() => window.open(`/print/trips/${bagTripId}`, "_blank")}
              >
                Cetak QR
              </Button>
              <Button variant="ghost" onClick={() => setBagTripId(null)}>
                Tutup
              </Button>
            </div>
            {issuedQrs.length > 0 ? (
              <div className="rounded-xl bg-mint/50 px-3 py-2 text-xs text-brand-800">
                <p className="mb-1 font-semibold">QR diterbitkan:</p>
                <p className="font-mono">{issuedQrs.join(", ")}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {valTripId ? (
        <Card>
          <CardHeader>
            <CardTitle>Validasi Manual (pengembalian sampah)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="QR tas (opsional)" htmlFor="v-qr">
                <Input
                  id="v-qr"
                  value={val.bagQrCode}
                  onChange={(e) => setVal((s) => ({ ...s, bagQrCode: e.target.value }))}
                  placeholder="BAG-XXXX"
                />
              </FormField>
              <FormField label="Jumlah tas kembali" htmlFor="v-ret">
                <Input
                  id="v-ret"
                  type="number"
                  min={0}
                  value={val.returnedBagCount}
                  onChange={(e) => setVal((s) => ({ ...s, returnedBagCount: e.target.value }))}
                />
              </FormField>
              <FormField label="Berat aktual (kg)" htmlFor="v-kg">
                <Input
                  id="v-kg"
                  type="number"
                  step="0.1"
                  value={val.actualWeightKg}
                  onChange={(e) => setVal((s) => ({ ...s, actualWeightKg: e.target.value }))}
                />
              </FormField>
              <FormField label="Kondisi" htmlFor="v-cond">
                <Select
                  id="v-cond"
                  value={val.conditionStatus}
                  onChange={(e) => setVal((s) => ({ ...s, conditionStatus: e.target.value }))}
                >
                  <option value="GOOD">Baik (terpilah)</option>
                  <option value="PARTIAL">Sebagian</option>
                  <option value="POOR">Buruk</option>
                  <option value="NOT_RETURNED">Tidak kembali</option>
                </Select>
              </FormField>
            </div>
            <FormField label="Catatan" htmlFor="v-notes">
              <Input
                id="v-notes"
                value={val.notes}
                onChange={(e) => setVal((s) => ({ ...s, notes: e.target.value }))}
              />
            </FormField>
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => submitValidation(valTripId)}>
                Simpan Validasi
              </Button>
              <Button variant="ghost" onClick={() => setValTripId(null)}>
                Batal
              </Button>
            </div>
            <p className="text-xs text-muted">
              Reward masuk ledger user trip bila kondisi Baik/Sebagian. Penalti tidak otomatis jadi denda uang.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <DataTable
        columns={columns}
        rows={trips}
        getRowKey={(r) => r.id}
        emptyTitle="Belum ada trip"
        emptyDescription="Buat trip untuk mode trash bag / wisata."
      />
    </div>
  );
}
