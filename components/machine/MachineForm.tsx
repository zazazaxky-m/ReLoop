"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, FormField, Input, Select, Textarea } from "@/components/ui";

interface Option {
  id: string;
  name: string;
}

interface MachineInitial {
  id: string;
  name: string;
  description: string | null;
  status: string;
  capacityKg: number | null;
  qrRotationSeconds: number;
  chamberTimeoutSeconds: number;
  hasInputChamber: boolean;
  hasConveyor: boolean;
  hasCompactor: boolean;
  hasExternalCamera: boolean;
  regionId: string | null;
  wasteTypeIds: string[];
}

const STATUSES = ["ONLINE", "OFFLINE", "FULL", "MAINTENANCE", "ERROR"];

export function MachineForm({
  mode,
  machine,
  wasteTypes,
  organizations,
  regions,
  onSuccess,
}: {
  mode: "create" | "edit";
  machine?: MachineInitial;
  wasteTypes: Option[];
  organizations?: Option[];
  regions?: Option[];
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    machineCode: "",
    name: machine?.name ?? "",
    description: machine?.description ?? "",
    status: machine?.status ?? "OFFLINE",
    organizationId: organizations?.[0]?.id ?? "",
    regionId: machine?.regionId ?? "",
    capacityKg: machine?.capacityKg?.toString() ?? "",
    qrRotationSeconds: (machine?.qrRotationSeconds ?? 30).toString(),
    chamberTimeoutSeconds: (machine?.chamberTimeoutSeconds ?? 20).toString(),
    hasInputChamber: machine?.hasInputChamber ?? true,
    hasConveyor: machine?.hasConveyor ?? true,
    hasCompactor: machine?.hasCompactor ?? false,
    hasExternalCamera: machine?.hasExternalCamera ?? false,
    wasteTypeIds: new Set<string>(machine?.wasteTypeIds ?? []),
  });

  function toggleWaste(id: string) {
    setForm((f) => {
      const next = new Set(f.wasteTypeIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...f, wasteTypeIds: next };
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        description: form.description || undefined,
        status: form.status,
        regionId: form.regionId || undefined,
        capacityKg: form.capacityKg ? Number(form.capacityKg) : undefined,
        qrRotationSeconds: Number(form.qrRotationSeconds),
        chamberTimeoutSeconds: Number(form.chamberTimeoutSeconds),
        hasInputChamber: form.hasInputChamber,
        hasConveyor: form.hasConveyor,
        hasCompactor: form.hasCompactor,
        hasExternalCamera: form.hasExternalCamera,
        wasteTypeIds: Array.from(form.wasteTypeIds),
      };
      if (mode === "create") {
        payload.machineCode = form.machineCode;
        if (organizations) payload.organizationId = form.organizationId;
      }
      const url = mode === "create" ? "/api/machines" : `/api/machines/${machine!.id}`;
      const res = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Gagal menyimpan mesin");
        return;
      }
      router.refresh();
      onSuccess?.();
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {mode === "create" ? (
          <FormField label="Kode Mesin" htmlFor="machineCode" required>
            <Input
              id="machineCode"
              value={form.machineCode}
              onChange={(e) => setForm((f) => ({ ...f, machineCode: e.target.value }))}
              placeholder="RLP-003"
              required
            />
          </FormField>
        ) : null}
        <FormField label="Nama Mesin" htmlFor="name" required>
          <Input
            id="name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Mesin Pasar Utama"
            required
          />
        </FormField>

        {organizations && mode === "create" ? (
          <FormField label="Organisasi" htmlFor="org" required>
            <Select
              id="org"
              value={form.organizationId}
              onChange={(e) => setForm((f) => ({ ...f, organizationId: e.target.value }))}
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}

        <FormField label="Status" htmlFor="status">
          <Select
            id="status"
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </FormField>

        {regions && regions.length > 0 ? (
          <FormField label="Lokasi / Wilayah" htmlFor="region">
            <Select
              id="region"
              value={form.regionId}
              onChange={(e) => setForm((f) => ({ ...f, regionId: e.target.value }))}
            >
              <option value="">- Pilih wilayah -</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}

        <FormField label="Kapasitas (kg)" htmlFor="capacity">
          <Input
            id="capacity"
            type="number"
            step="0.1"
            value={form.capacityKg}
            onChange={(e) => setForm((f) => ({ ...f, capacityKg: e.target.value }))}
            placeholder="50"
          />
        </FormField>
        <FormField label="Rotasi QR (detik)" htmlFor="rotation">
          <Input
            id="rotation"
            type="number"
            value={form.qrRotationSeconds}
            onChange={(e) => setForm((f) => ({ ...f, qrRotationSeconds: e.target.value }))}
          />
        </FormField>
        <FormField label="Timeout Chamber (detik)" htmlFor="timeout">
          <Input
            id="timeout"
            type="number"
            value={form.chamberTimeoutSeconds}
            onChange={(e) => setForm((f) => ({ ...f, chamberTimeoutSeconds: e.target.value }))}
          />
        </FormField>
      </div>

      <FormField label="Deskripsi" htmlFor="desc">
        <Textarea
          id="desc"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Lokasi & catatan mesin"
        />
      </FormField>

      <div>
        <p className="mb-2 text-sm font-medium text-foreground">Komponen Hardware</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["hasInputChamber", "Input chamber / sekat"],
              ["hasConveyor", "Conveyor"],
              ["hasCompactor", "Press / compactor internal"],
              ["hasExternalCamera", "Kamera eksternal anti-fraud"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                checked={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))}
                className="h-4 w-4 accent-brand-500"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-foreground">Jenis Sampah Didukung</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {wasteTypes.map((w) => (
            <label
              key={w.id}
              className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                checked={form.wasteTypeIds.has(w.id)}
                onChange={() => toggleWaste(w.id)}
                className="h-4 w-4 accent-brand-500"
              />
              {w.name}
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={loading}>
          {loading ? "Menyimpan..." : mode === "create" ? "Buat Mesin" : "Simpan Perubahan"}
        </Button>
      </div>
    </form>
  );
}
