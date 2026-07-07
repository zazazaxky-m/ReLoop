"use client";

import { useState } from "react";
import { Button, Card, CardContent } from "@/components/ui";

type VerifyResult = { valid: boolean; brokenAt?: string };

export function AuditChainVerifier() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runVerify() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/audit/verify", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Verifikasi gagal");
        return;
      }
      setResult(data as VerifyResult);
    } catch {
      setError("Tidak dapat menghubungi server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <p className="font-semibold text-foreground">Integritas rantai audit</p>
          <p className="text-sm text-muted">
            Verifikasi checksum SHA-256 seluruh log audit untuk mendeteksi manipulasi.
          </p>
          {result ? (
            <p
              className={`mt-2 text-sm font-medium ${result.valid ? "text-brand-700" : "text-amber-700"}`}
            >
              {result.valid
                ? "Rantai audit valid."
                : `Rantai rusak pada entri ${result.brokenAt ?? "tidak diketahui"}.`}
            </p>
          ) : null}
          {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        </div>
        <Button type="button" onClick={runVerify} disabled={loading}>
          {loading ? "Memverifikasi…" : "Verifikasi rantai"}
        </Button>
      </CardContent>
    </Card>
  );
}
