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

interface CampaignOption extends Option {
  campaignType?: string;
  rewardMode?: string;
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
  rewardUserEmail?: string | null;
  rewardUserName?: string | null;
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
  actualWeightKg: "",
};

export function TripManager({
  trips,
  campaigns,
  travelAgents,
  wasteTypes,
}: {
  trips: TripRow[];
  campaigns: CampaignOption[];
  travelAgents: TravelAgentOption[];
  wasteTypes: Option[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY, campaignId: campaigns[0]?.id ?? "" });
  const selectedCampaign = campaigns.find((c) => c.id === form.campaignId);
  const agentRequired = selectedCampaign?.campaignType === "TOURISM_PROGRAM";
  const moneyReward = selectedCampaign?.rewardMode === "MONEY_REWARD";
  
  const [bagTripId, setBagTripId] = useState<string | null>(null);
  const [bagCount, setBagCount] = useState("10");
  const [bagWasteTypeId, setBagWasteTypeId] = useState("");
  const [issuedQrs, setIssuedQrs] = useState<string[]>([]);
  
  const [valTripId, setValTripId] = useState<string | null>(null);
  const [val, setVal] = useState({ ...EMPTY_VALIDATION });
  const [valTripBags, setValTripBags] = useState<any[]>([]);
  const [viewQrTripId, setViewQrTripId] = useState<string | null>(null);
  const [viewQrBags, setViewQrBags] = useState<any[]>([]);

  const [globalScanQr, setGlobalScanQr] = useState("");
  const [cameraOn, setCameraOn] = useState(false);

  async function createTrip(e: React.FormEvent) {
    e.preventDefault();
    if (moneyReward && !form.userEmail.trim()) {
      setError("Campaign reward uang wajib mengisi email user penerima reward");
      return;
    }
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

  async function updateTripStatus(tripId: string, status: "CANCELLED" | "PLANNED") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d?.error ?? "Gagal mengubah status trip");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function assignBags(tripId: string) {
    const count = Number(bagCount) || 1;
    if (count < 1 || count > 200) {
      setError("Jumlah tas harus antara 1 dan 200");
      return;
    }
    setBusy(true);
    setError(null);
    setIssuedQrs([]);
    try {
      const res = await fetch("/api/trash-bags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId,
          bagCount: count,
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
      // CHECK_IN must not send bags[] — empty statuses would stamp every bag NOT_RETURNED.
      const bagsPayload =
        stage === "CHECK_OUT"
          ? valTripBags.map((b) => ({
              id: b.id,
              status: b.status || "NOT_RETURNED",
            }))
          : undefined;

      if (stage === "CHECK_OUT" && (!bagsPayload || bagsPayload.length === 0)) {
        setError("Belum ada kantong untuk check-out. Terbitkan kantong dulu.");
        return;
      }

      const res = await fetch("/api/manual-validations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId,
          validationStage: stage,
          gateType: stage === "CHECK_IN" ? "ENTRY" : "EXIT",
          appCompleted: val.appCompleted,
          notes: val.notes || undefined,
          ...(val.actualWeightKg.trim()
            ? { actualWeightKg: Number(val.actualWeightKg) }
            : {}),
          ...(bagsPayload ? { bags: bagsPayload } : {}),
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
        const tripStatus = bag.trip?.status as string | undefined;
        setBagTripId(null);
        setViewQrTripId(null);
        setValTripId(bag.tripId);
        setVal({
          ...EMPTY_VALIDATION,
          validationStage: tripStatus === "PLANNED" ? "CHECK_IN" : "CHECK_OUT",
        });
        await loadBagsForTrip(bag.tripId, bag.bagQrCode);
        setGlobalScanQr("");
      } else {
        setError("QR Tas tidak ditemukan atau belum terdaftar.");
      }
    } catch {
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
            {r.rewardMode === "MONEY_REWARD"
              ? r.rewardUserEmail
                ? ` - reward: ${r.rewardUserEmail}`
                : " - tanpa penerima reward"
              : ""}
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
      render: (r) => {
        const canOperate = r.status === "PLANNED" || r.status === "ACTIVE";
        return (
          <div className="flex flex-wrap justify-end gap-1.5">
            {canOperate ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setBagTripId(bagTripId === r.id ? null : r.id);
                  setValTripId(null);
                  setViewQrTripId(null);
                  setViewQrBags([]);
                  setIssuedQrs([]);
                  setBagWasteTypeId("");
                }}
              >
                Tas
              </Button>
            ) : null}
            {canOperate ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  const isOpening = valTripId !== r.id;
                  setValTripId(isOpening ? r.id : null);
                  setBagTripId(null);
                  setViewQrTripId(null);
                  setViewQrBags([]);
                  if (isOpening) {
                    setVal({
                      ...EMPTY_VALIDATION,
                      validationStage: r.status === "PLANNED" ? "CHECK_IN" : "CHECK_OUT",
                    });
                    loadBagsForTrip(r.id);
                  }
                }}
              >
                Validasi
              </Button>
            ) : null}
            {r.bagCount > 0 ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={async () => {
                    if (viewQrTripId === r.id) {
                      setViewQrTripId(null);
                      setViewQrBags([]);
                      return;
                    }
                    setBagTripId(null);
                    setValTripId(null);
                    setBusy(true);
                    try {
                      const res = await fetch(`/api/trash-bags?tripId=${r.id}`);
                      const data = await res.json();
                      if (res.ok) {
                        setViewQrBags(data.bags || []);
                        setViewQrTripId(r.id);
                      } else {
                        setError(data?.error ?? "Gagal memuat QR");
                      }
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Lihat QR
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => window.open(`/print/trips/${r.id}`, "_blank")}
                >
                  Print
                </Button>
              </>
            ) : null}
            {canOperate ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Batalkan trip ini?")) {
                    void updateTripStatus(r.id, "CANCELLED");
                  }
                }}
              >
                Batalkan
              </Button>
            ) : null}
            {r.status === "CANCELLED" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void updateTripStatus(r.id, "PLANNED")}
              >
                Buka Ulang
              </Button>
            ) : null}
          </div>
        );
      },
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
                <FormField
                  label="Campaign"
                  htmlFor="t-campaign"
                  required
                  hint="Hanya campaign ACTIVE bertipe Trash Bag / Program Wisata."
                >
                  <Select
                    id="t-campaign"
                    value={form.campaignId}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        campaignId: e.target.value,
                        travelAgentId: "",
                      }))
                    }
                  >
                    {campaigns.length === 0 ? (
                      <option value="">Belum ada campaign ACTIVE</option>
                    ) : (
                      campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.campaignType === "TOURISM_PROGRAM"
                            ? " · Wisata"
                            : c.campaignType === "TRASH_BAG"
                              ? " · Trash Bag"
                              : ""}
                        </option>
                      ))
                    )}
                  </Select>
                </FormField>
                <FormField
                  label="Travel agent"
                  htmlFor="t-agent"
                  required={agentRequired}
                  hint={
                    agentRequired
                      ? "Wajib untuk Program Wisata."
                      : "Opsional untuk Trash Bag (boleh tanpa agent)."
                  }
                >
                  <Select
                    id="t-agent"
                    value={form.travelAgentId}
                    onChange={(e) => setForm((f) => ({ ...f, travelAgentId: e.target.value }))}
                    required={agentRequired}
                  >
                    <option value="">
                      {agentRequired ? "Pilih travel agent" : "Tanpa travel agent"}
                    </option>
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
                  label={moneyReward ? "Email user penerima reward" : "Email user (opsional)"}
                  htmlFor="t-user"
                  required={moneyReward}
                  hint={
                    moneyReward
                      ? "Wajib. Reward uang hanya masuk jika email user terisi."
                      : "Opsional. Campaign ini compliance-only (tanpa reward uang)."
                  }
                >
                  <Input
                    id="t-user"
                    type="email"
                    value={form.userEmail}
                    onChange={(e) => setForm((f) => ({ ...f, userEmail: e.target.value }))}
                    required={moneyReward}
                  />
                </FormField>
              </div>
              {campaigns.length === 0 ? (
                <p className="text-sm text-amber-700">
                  Belum ada campaign ACTIVE tipe Trash Bag / Program Wisata. Aktifkan campaign dulu.
                </p>
              ) : null}
              {agentRequired && travelAgents.length === 0 ? (
                <p className="text-sm text-amber-700">
                  Program Wisata membutuhkan travel agent berstatus INVITED.
                </p>
              ) : null}
              <Button
                type="submit"
                disabled={
                  busy ||
                  campaigns.length === 0 ||
                  (agentRequired && (travelAgents.length === 0 || !form.travelAgentId))
                }
              >
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
                  max={200}
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

      {viewQrTripId ? (
        <Card>
          <CardHeader>
            <CardTitle>QR Kantong Trip</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {viewQrBags.length === 0 ? (
              <p className="text-sm text-muted">Belum ada kantong untuk trip ini.</p>
            ) : (
              <div className="rounded-xl bg-mint/50 px-3 py-2 text-xs text-brand-800 dark:text-brand-400">
                <p className="mb-1 font-semibold">{viewQrBags.length} QR:</p>
                <p className="font-mono break-all">
                  {viewQrBags.map((b: { bagQrCode: string }) => b.bagQrCode).join(", ")}
                </p>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => window.open(`/print/trips/${viewQrTripId}`, "_blank")}
              >
                Cetak QR
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setViewQrTripId(null);
                  setViewQrBags([]);
                }}
              >
                Tutup
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {valTripId ? (
        <Card>
          <CardHeader>
            <CardTitle>Daftar Tas & Validasi Gerbang</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {val.validationStage === "CHECK_OUT" ? (
              valTripBags.length === 0 ? (
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
              )
            ) : (
              <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 p-4 text-sm text-muted">
                Check-in hanya mencatat gerbang masuk. Kondisi kantong diisi saat check-out.
                {valTripBags.length > 0 ? ` (${valTripBags.length} kantong terdaftar)` : ""}
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
              {val.validationStage === "CHECK_OUT" ? (
                <FormField label="Berat aktual (kg, opsional)" htmlFor="v-weight" className="mt-3">
                  <Input
                    id="v-weight"
                    type="number"
                    min={0}
                    step="0.1"
                    value={val.actualWeightKg}
                    onChange={(e) => setVal((s) => ({ ...s, actualWeightKg: e.target.value }))}
                    placeholder="Contoh: 12.5"
                  />
                </FormField>
              ) : null}
            </div>

            <div className="flex gap-2">
              <Button
                disabled={
                  busy ||
                  (val.validationStage === "CHECK_OUT" && valTripBags.length === 0)
                }
                onClick={() => submitValidation(valTripId)}
              >
                Simpan Validasi
              </Button>
              <Button variant="ghost" onClick={() => setValTripId(null)}>
                Batal
              </Button>
            </div>
            {val.validationStage === "CHECK_OUT" ? (
              <p className="text-xs text-muted">
                Pastikan semua kondisi tas sudah sesuai. Tas yang kondisinya kosong akan dianggap hilang (Tidak Kembali).
              </p>
            ) : null}
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
