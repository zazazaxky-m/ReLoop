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
  /** True when an active factor is being replaced (it stays active until confirm). */
  replacement?: boolean;
  expiresAt?: string;
}

/** Proof forms shown while MFA is active. */
type ProofMode = "idle" | "replace" | "disable";

function CodeInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FormField label={label} htmlFor={id} required>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        placeholder="000000"
        required
      />
    </FormField>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FormField label="Password saat ini" htmlFor={id} required>
      <Input
        id={id}
        type="password"
        autoComplete="current-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
      />
    </FormField>
  );
}

function expiryLabel(expiresAt?: string): string | null {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

export function MfaManager() {
  const router = useRouter();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<SetupPayload | null>(null);
  const [mode, setMode] = useState<ProofMode>("idle");
  const [password, setPassword] = useState("");
  const [currentCode, setCurrentCode] = useState("");
  const [enableCode, setEnableCode] = useState("");
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

  function resetProof(nextMode: ProofMode = "idle") {
    setMode(nextMode);
    setPassword("");
    setCurrentCode("");
    setError(null);
    setMessage(null);
  }

  /** First setup (password) or replacement (password + code of the active factor). */
  async function startSetup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const body = status?.mfaEnabled
        ? { currentPassword: password, currentCode }
        : { currentPassword: password };
      const res = await fetch("/api/auth/mfa/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setCurrentCode("");
      if (!res.ok) {
        setError(data?.error ?? "Gagal memulai setup MFA");
        return;
      }
      setPassword("");
      setMode("idle");
      setSetup(data);
      setEnableCode("");
      setMessage(data?.message ?? "Scan QR di aplikasi authenticator, lalu masukkan kode 6 digit.");
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
      setEnableCode("");
      if (!res.ok) {
        // 409: the setup expired or was cancelled; the active factor is unchanged.
        if (res.status === 409) setSetup(null);
        setError(data?.error ?? "Kode MFA tidak valid");
        return;
      }
      setSetup(null);
      setMessage(data?.message ?? "MFA berhasil diaktifkan.");
      await loadStatus();
      router.refresh();
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setBusy(false);
    }
  }

  /** Discards only the pending setup; an active factor keeps working. */
  async function cancelSetup() {
    const replacement = Boolean(setup?.replacement);
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/mfa/setup", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Gagal membatalkan setup MFA");
        return;
      }
      setSetup(null);
      setEnableCode("");
      setMessage(
        replacement
          ? "Penggantian dibatalkan. Perangkat MFA lama tetap aktif."
          : "Setup MFA dibatalkan.",
      );
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
        body: JSON.stringify({ currentPassword: password, code: currentCode }),
      });
      const data = await res.json();
      setCurrentCode("");
      if (!res.ok) {
        setError(data?.error ?? "Password atau kode MFA tidak valid");
        return;
      }
      setPassword("");
      setMode("idle");
      setMessage(data?.message ?? "MFA berhasil dinonaktifkan.");
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

  const expiry = expiryLabel(setup?.expiresAt);

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

          {setup ? (
            <form onSubmit={enableMfa} className="space-y-4">
              <p className="text-sm text-muted">
                {setup.replacement
                  ? "Penggantian perangkat MFA. Perangkat lama tetap aktif sampai kode dari perangkat baru dikonfirmasi."
                  : "Setup MFA pertama. MFA baru aktif setelah kode dikonfirmasi."}
                {expiry ? ` Setup ini berlaku sampai pukul ${expiry}.` : null}
              </p>
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
              <CodeInput
                id="enable-code"
                label={setup.replacement ? "Kode dari perangkat baru" : "Kode verifikasi"}
                value={enableCode}
                onChange={setEnableCode}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy}>
                  {busy
                    ? "Memverifikasi..."
                    : setup.replacement
                      ? "Konfirmasi penggantian"
                      : "Aktifkan MFA"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void cancelSetup()}
                >
                  Batal
                </Button>
              </div>
            </form>
          ) : status.mfaEnabled ? (
            mode === "idle" ? (
              <div className="space-y-3">
                <p className="text-sm text-muted">
                  MFA aktif. Mengganti perangkat atau menonaktifkan MFA memerlukan password dan
                  kode dari aplikasi authenticator yang aktif. Jika perangkat hilang, hubungi
                  tim operasional ReLoop untuk pemulihan dengan verifikasi identitas.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => resetProof("replace")} disabled={busy}>
                    Ganti perangkat authenticator
                  </Button>
                  <Button variant="secondary" onClick={() => resetProof("disable")} disabled={busy}>
                    Nonaktifkan MFA
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={mode === "replace" ? startSetup : disableMfa} className="space-y-3">
                <p className="text-sm text-muted">
                  {mode === "replace"
                    ? "Konfirmasi identitas Anda. Perangkat lama tetap aktif sampai perangkat baru dikonfirmasi."
                    : "Konfirmasi identitas Anda untuk menonaktifkan MFA. Sesi di perangkat lain akan dikeluarkan."}
                </p>
                <PasswordInput id="mfa-current-password" value={password} onChange={setPassword} />
                <CodeInput
                  id="mfa-current-code"
                  label="Kode MFA saat ini"
                  value={currentCode}
                  onChange={setCurrentCode}
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variant={mode === "disable" ? "danger" : "primary"} disabled={busy}>
                    {busy
                      ? "Memproses..."
                      : mode === "replace"
                        ? "Lanjutkan penggantian"
                        : "Nonaktifkan MFA"}
                  </Button>
                  <Button type="button" variant="secondary" disabled={busy} onClick={() => resetProof("idle")}>
                    Batal
                  </Button>
                </div>
              </form>
            )
          ) : (
            <form onSubmit={startSetup} className="space-y-3">
              <p className="text-sm text-muted">
                {status.requiredForRole
                  ? "Akun admin disarankan mengaktifkan MFA sebelum mengelola operasi sensitif. Masukkan password untuk memulai."
                  : "MFA hanya tersedia untuk peran admin."}
              </p>
              <PasswordInput id="mfa-setup-password" value={password} onChange={setPassword} />
              <Button type="submit" disabled={busy}>
                {busy ? "Menyiapkan..." : "Mulai setup MFA"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
