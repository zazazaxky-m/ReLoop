"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { MachineForm } from "./MachineForm";

interface Option {
  id: string;
  name: string;
}

interface MachineInitial {
  id: string;
  machineCode: string;
  name: string;
  description: string | null;
  status: string;
  capacityKg: number | null;
  qrRotationSeconds: number;
  chamberTimeoutSeconds: number;
  sessionIdleTimeoutMinutes: number;
  hasInputChamber: boolean;
  hasConveyor: boolean;
  hasCompactor: boolean;
  hasExternalCamera: boolean;
  regionId: string | null;
  wasteTypeIds: string[];
}

const QUICK_STATUS = ["ONLINE", "OFFLINE", "MAINTENANCE", "FULL"];

export function MachineControls({
  machine,
  wasteTypes,
  regions,
  listHref,
}: {
  machine: MachineInitial;
  wasteTypes: Option[];
  regions?: Option[];
  listHref: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/machines/${machine.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error ?? "Gagal memperbarui mesin");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Hapus mesin ${machine.machineCode}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/machines/${machine.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error ?? "Gagal menghapus mesin");
        return;
      }
      router.push(listHref);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kontrol Mesin</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 px-3.5 py-2.5 text-sm text-status-error">
            {error}
          </div>
        ) : null}

        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Ubah Status</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_STATUS.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={machine.status === s ? "primary" : "outline"}
                disabled={busy}
                onClick={() => patch({ status: s })}
              >
                {s}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditing((v) => !v)}>
            {editing ? "Batal Edit" : "Edit Detail"}
          </Button>
          <Button variant="danger" disabled={busy} onClick={remove}>
            Hapus Mesin
          </Button>
        </div>

        {editing ? (
          <div className="border-t border-border pt-4">
            <MachineForm
              mode="edit"
              machine={machine}
              wasteTypes={wasteTypes}
              regions={regions}
              onSuccess={() => setEditing(false)}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
