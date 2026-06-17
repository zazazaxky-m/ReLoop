"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormField,
  Input,
} from "@/components/ui";

export function ConfigEditor({
  initial,
}: {
  initial: { minRedemption: number; qrRotation: number; pointsToRupiah: number };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    min_redemption: String(initial.minRedemption),
    default_qr_rotation_seconds: String(initial.qrRotation),
    points_to_rupiah: String(initial.pointsToRupiah),
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          min_redemption: Number(form.min_redemption),
          default_qr_rotation_seconds: Number(form.default_qr_rotation_seconds),
          points_to_rupiah: Number(form.points_to_rupiah),
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d?.error ?? "Gagal menyimpan konfigurasi");
        return;
      }
      setMsg("Konfigurasi tersimpan.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Editor Konfigurasi</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="space-y-4">
          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error">
              {error}
            </div>
          ) : null}
          {msg ? (
            <div className="rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm text-brand-700">
              {msg}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Minimum redemption (Rp)" htmlFor="cfg-min">
              <Input
                id="cfg-min"
                type="number"
                value={form.min_redemption}
                onChange={(e) => setForm((f) => ({ ...f, min_redemption: e.target.value }))}
              />
            </FormField>
            <FormField label="Rotasi QR default (detik)" htmlFor="cfg-qr">
              <Input
                id="cfg-qr"
                type="number"
                value={form.default_qr_rotation_seconds}
                onChange={(e) =>
                  setForm((f) => ({ ...f, default_qr_rotation_seconds: e.target.value }))
                }
              />
            </FormField>
            <FormField label="1 poin = Rp" htmlFor="cfg-pts">
              <Input
                id="cfg-pts"
                type="number"
                value={form.points_to_rupiah}
                onChange={(e) => setForm((f) => ({ ...f, points_to_rupiah: e.target.value }))}
              />
            </FormField>
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Menyimpan..." : "Simpan Konfigurasi"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
