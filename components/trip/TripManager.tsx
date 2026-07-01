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
import { Plus, QrCode } from "@/components/ui/icons";
import { QrScanner } from "@/components/scan/QrScanner";

interface Option {
  id: string;
  name: string;
}

interface TravelAgentOption extends Option {
  email: string;
}

export interface TripRow {
  id: string;
  campaignName: string;
  rewardMode: string;
  travelAgentId: string | null;
  travelAgentName: string | null;
  groupName: string | null;
  leaderName: string | null;
  participantCount: number;
  status: string;
  complianceStatus: string;
  complianceScore: number;
  bagCount: number;
  validationCount: number;
  hasUser: boolean;
}

const EMPTY = {
  campaignId: "",
  travelAgentId: "",
  groupName: "",
  leaderName: "",
  leaderContact: "",
  participantCount: "1",
  userEmail: "",
};

const EMPTY_VALIDATION = {
  validationStage: "CHECK_OUT",
  appCompleted: true,
  notes: "",
};

export function TripManager({
  trips,
  campaigns,
  travelAgents,
  wasteTypes,
}: {
  trips: TripRow[];
  campaigns: Option[];
  travelAgents: TravelAgentOption[];
  wasteTypes: Option[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY, campaignId: campaigns[0]?.id ?? "" });
  
  const [bagTripId, setBagTripId] = useState<string | null>(null);
  const [bagCount, setBagCount] = useState("5");
  const [bagWasteTypeId, setBagWasteTypeId] = useState("");
  const [issuedQrs, setIssuedQrs] = useState<string[]>([]);
  
  const [valTripId, setValTripId] = useState<string | null>(null);
  const [val, setVal] = useState({ ...EMPTY_VALIDATION });
  const [valTripBags, setValTripBags] = useState<any[]>([]);
  
  const [globalScanQr, setGlobalScanQr] = useState("");
  const [cameraOn, setCameraOn] = useState(false);

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
          travelAgentId: form.travelAgentId || undefined,
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
        body: JSON.stringify({
          tripId,
          bagCount: Number(bagCount) || 1,
          wasteTypeId: bagWasteTypeId || undefined,
        }),
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

  async function loadBagsForTrip(tripId: string, preSelectQr?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/trash-bags?tripId=${tripId}`);
      const data = await res.json();
      if (res.ok) {
        const bags = data.bags || [];
        if (preSelectQr) {
          const updated = bags.map((b: any) =>
            b.bagQrCode === preSelectQr ? { ...b, status: b.status || "GOOD" } : b
          );
          setValTripBags(updated);
        } else {
          setValTripBags(bags);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitValidation(tripId: string) {
    setBusy(true);
    setError(null);
    try {
      const stage = val.validationStage;
      const bagsPayload = valTripBags.map(b => ({
        id: b.id,
        status: b.status || "NOT_RETURNED"
      }));

      const res = await fetch("/api/manual-validations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId,
          validationStage: stage,
          gateType: stage === "CHECK_IN" ? "ENTRY" : "EXIT",
          appCompleted: val.appCompleted,
          notes: val.notes || undefined,
          bags: bagsPayload,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d?.error ?? "Gagal validasi");
        return;
      }
      setValTripId(null);
      setVal({ ...EMPTY_VALIDATION });
      setValTripBags([]);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleGlobalScanText(qr: string) {
    if (!qr) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/trash-bags?qrCode=${encodeURIComponent(qr)}`);
      const data = await res.json();
      if (res.ok && data.bags && data.bags.length > 0) {
        const bag = data.bags[0];
        setValTripId(bag.tripId);
        await loadBagsForTrip(bag.tripId, bag.bagQrCode);
        setGlobalScanQr("");
      } else {
        setError("QR Tas tidak ditemukan atau belum terdaftar.");
      }
    } catch (err) {
      setError("Gagal scan QR.");
    } finally {
      setBusy(false);
    }
  }

  async function handleGlobalScan(e: React.FormEvent) {
    e.preventDefault();
    await handleGlobalScanText(globalScanQr);
  }

  function setBagStatus(id: string, status: string) {
    setValTripBags(prev => prev.map(b => b.id === id ? { ...b, status } : b));
  }

  const columns: Column<TripRow>[] = [
    {
      key: "trip",
      header: "Trip",
      render: (r) => (
        <div>
          <p className="font-medium text-foreground">{r.groupName ?? r.campaignName}</p>
          <p className="text-xs text-muted">
            {r.travelAgentName ?? "Travel agent belum dipilih"} - {r.participantCount} peserta
            {r.leaderName ? ` - ${r.leaderName}` : ""}
            {r.hasUser && r.rewardMode === "MONEY_REWARD" ? " - reward ke user" : ""}
          </p>
        </div>
      ),
    },
    { key: "bags", header: "Tas", render: (r) => `${r.bagCount}` },
    { key: "validations", header: "Validasi", render: (r) => `${r.validationCount}` },
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
              setBagWasteTypeId("");
            }}
          >
            Tas
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              const isOpening = valTripId !== r.id;
              setValTripId(isOpening ? r.id : null);
              setBagTripId(null);
              if (isOpening) {
                loadBagsForTrip(r.id);
              }
            }}
          >
            Lihat Tas
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
        <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 px-3.5 py-2.5 text-sm text-status-error">
          {error}
        </div>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-foreground">Trip & Trash Bag</h2>
        
        <div className="flex items-center gap-3">
          <form onSubmit={handleGlobalScan} className="flex items-center gap-2">
            <Input
              placeholder="Scan QR Tas..."
              value={globalScanQr}
              onChange={(e) => setGlobalScanQr(e.target.value)}
              className="w-48"
            />
            <Button type="button" variant="outline" onClick={() => setCameraOn(!cameraOn)}>
              <QrCode className="mr-2 h-4 w-4" /> Kamera
            </Button>
            <Button type="submit" variant="secondary" disabled={busy || !globalScanQr}>
              Cari
            </Button>
          </form>

          <Button
            variant={open ? "outline" : "primary"}
            disabled={campaigns.length === 0}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Tutup" : <><Plus /> Buat Trip</>}
          </Button>
        </div>
      </div>

      {cameraOn ? (
        <Card>
          <CardContent className="pt-6">
            <QrScanner
              onResult={(text) => {
                setCameraOn(false);
                setGlobalScanQr(text);
                void handleGlobalScanText(text);
              }}
              onCancel={() => setCameraOn(false)}
            />
          </CardContent>
        </Card>
      ) : null}

      {campaigns.length === 0 ? (
        <p className="text-sm text-muted">
          Buat campaign tipe Trash Bag / Program Wisata terlebih dahulu untuk membuat trip.
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
                <FormField label="Travel agent" htmlFor="t-agent" required>
                  <Select
                    id="t-agent"
                    value={form.travelAgentId}
                    onChange={(e) => setForm((f) => ({ ...f, travelAgentId: e.target.value }))}
                    required
                  >
                    <option value="">Pilih travel agent</option>
                    {travelAgents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name} ({agent.email})
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
                <FormField
                  label="Email user (opsional)"
                  htmlFor="t-user"
                  hint="Hanya dipakai jika campaign memakai reward uang."
                >
                  <Input
                    id="t-user"
                    type="email"
                    value={form.userEmail}
                    onChange={(e) => setForm((f) => ({ ...f, userEmail: e.target.value }))}
                  />
                </FormField>
              </div>
              <Button type="submit" disabled={busy || travelAgents.length === 0}>
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
              <FormField label="Jenis sampah" htmlFor="bag-waste-type" className="min-w-56">
                <Select
                  id="bag-waste-type"
                  value={bagWasteTypeId}
                  onChange={(e) => setBagWasteTypeId(e.target.value)}
                >
                  <option value="">Campuran / belum dipetakan</option>
                  {wasteTypes.map((wasteType) => (
                    <option key={wasteType.id} value={wasteType.id}>
                      {wasteType.name}
                    </option>
                  ))}
                </Select>
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
              <div className="rounded-xl bg-mint/50 px-3 py-2 text-xs text-brand-800 dark:text-brand-400">
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
            <CardTitle>Daftar Tas & Validasi Gerbang</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {valTripBags.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 p-4 text-center text-sm text-muted">
                Tidak ada tas yang terdaftar untuk trip ini.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {valTripBags.map((bag) => (
                    <div key={bag.id} className="p-3 border rounded-xl border-gray-200 dark:border-gray-800 space-y-2 bg-surface">
                      <div className="flex justify-between items-center">
                        <span className="font-mono text-sm font-semibold text-brand-800 dark:text-brand-400">{bag.bagQrCode}</span>
                        {bag.wasteType?.name && (
                          <span className="text-xs text-muted-soft">{bag.wasteType.name}</span>
                        )}
                      </div>
                      <Select
                        value={bag.status || ""}
                        onChange={(e) => setBagStatus(bag.id, e.target.value)}
                        className="text-sm"
                      >
                        <option value="" disabled>Pilih Kondisi...</option>
                        <option value="GOOD">Terpilah dengan baik</option>
                        <option value="PARTIAL">Tercampur sebagian</option>
                        <option value="POOR">Tercampur (Buruk)</option>
                        <option value="NOT_RETURNED">Hilang / Tidak Kembali</option>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-gray-200 dark:border-gray-800 pt-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Tahap validasi" htmlFor="v-stage">
                  <Select
                    id="v-stage"
                    value={val.validationStage}
                    onChange={(e) => setVal((s) => ({ ...s, validationStage: e.target.value }))}
                  >
                    <option value="CHECK_IN">Gerbang masuk</option>
                    <option value="CHECK_OUT">Gerbang pulang</option>
                  </Select>
                </FormField>
                <FormField label="Aplikasi sudah diisi" htmlFor="v-app">
                  <Select
                    id="v-app"
                    value={val.appCompleted ? "YES" : "NO"}
                    onChange={(e) => setVal((s) => ({ ...s, appCompleted: e.target.value === "YES" }))}
                  >
                    <option value="YES">Ya</option>
                    <option value="NO">Belum</option>
                  </Select>
                </FormField>
              </div>
              <FormField label="Catatan" htmlFor="v-notes" className="mt-3">
                <Input
                  id="v-notes"
                  value={val.notes}
                  onChange={(e) => setVal((s) => ({ ...s, notes: e.target.value }))}
                />
              </FormField>
            </div>
            
            <div className="flex gap-2">
              <Button disabled={busy || valTripBags.length === 0} onClick={() => submitValidation(valTripId)}>
                Simpan Validasi
              </Button>
              <Button variant="ghost" onClick={() => setValTripId(null)}>
                Batal
              </Button>
            </div>
            <p className="text-xs text-muted">
              Pastikan semua kondisi tas sudah sesuai. Tas yang kondisinya kosong akan dianggap hilang (Tidak Kembali).
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
