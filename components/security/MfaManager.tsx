"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  StatusBadge,
} from "@/components/ui";

interface MfaStatus {
  mfaEnabled: boolean;
  requiredForRole: boolean;
}

interface SetupPayload {
  secret: string;
  otpauthUrl: string;
  qrDataUrl?: string;
  message?: string;
}

export function MfaManager() {
  const router = useRouter();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<SetupPayload | null>(null);
  const [enableCode, setEnableCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/auth/mfa/status", { cache: "no-store" });
    if (!res.ok) {
      setError("Gagal memuat status MFA");
      return;
    }
    setStatus(await res.json());
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadStatus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [loadStatus]);

  async function startSetup() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/mfa/setup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Gagal memulai setup MFA");
        return;
      }
      setSetup(data);
      setEnableCode("");
      setMessage("Scan QR di aplikasi authenticator, lalu masukkan kode 6 digit.");
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setBusy(false);
    }
  }

  async function enableMfa(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/mfa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: enableCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Kode MFA tidak valid");
        return;
      }
      setSetup(null);
      setEnableCode("");
      setMessage("MFA berhasil diaktifkan.");
      await loadStatus();
      router.refresh();
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setBusy(false);
    }
  }

  async function disableMfa(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: disableCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Kode MFA tidak valid");
        return;
      }
      setDisableCode("");
      setMessage("MFA berhasil dinonaktifkan.");
      await loadStatus();
      router.refresh();
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setBusy(false);
    }
  }

  if (!status) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted">
          Memuat status MFA...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>Autentikasi dua faktor (MFA)</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Wajib untuk akun admin saat login jika diaktifkan.
            </p>
          </div>
          <StatusBadge status={status.mfaEnabled ? "ACTIVE" : "INACTIVE"} />
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error dark:border-red-900/30 dark:bg-red-950/20">
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm text-brand-800 dark:border-brand-900/30 dark:bg-brand-950/20 dark:text-brand-400">
              {message}
            </div>
          ) : null}

          {status.mfaEnabled ? (
            <form onSubmit={disableMfa} className="space-y-3">
              <p className="text-sm text-muted">
                MFA aktif. Masukkan kode dari aplikasi authenticator untuk menonaktifkan.
              </p>
              <FormField label="Kode MFA" htmlFor="disable-code" required>
                <Input
                  id="disable-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  required
                />
              </FormField>
              <Button type="submit" variant="secondary" disabled={busy}>
                {busy ? "Memproses..." : "Nonaktifkan MFA"}
              </Button>
            </form>
          ) : setup ? (
            <form onSubmit={enableMfa} className="space-y-4">
              {setup.qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={setup.qrDataUrl}
                  alt="QR MFA"
                  className="mx-auto h-56 w-56 rounded-xl border border-border bg-white p-3"
                />
              ) : null}
              <div className="rounded-xl bg-surface-soft px-3 py-2 text-xs text-muted">
                <p className="font-semibold text-foreground">Secret manual</p>
                <p className="mt-1 break-all font-mono">{setup.secret}</p>
                <p className="mt-2 break-all">{setup.otpauthUrl}</p>
              </div>
              <FormField label="Kode verifikasi" htmlFor="enable-code" required>
                <Input
                  id="enable-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={enableCode}
                  onChange={(e) => setEnableCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  required
                />
              </FormField>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "Memverifikasi..." : "Aktifkan MFA"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setSetup(null)}
                >
                  Batal
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                {status.requiredForRole
                  ? "Akun admin disarankan mengaktifkan MFA sebelum mengelola operasi sensitif."
                  : "MFA hanya tersedia untuk peran admin."}
              </p>
              <Button onClick={() => void startSetup()} disabled={busy}>
                {busy ? "Menyiapkan..." : "Mulai setup MFA"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
