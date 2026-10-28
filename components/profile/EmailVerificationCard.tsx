"use client";

import { useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { CheckCircle, Info } from "@/components/ui/icons";

export interface MembershipRow {
  travelAgentId: string;
  travelAgentName: string;
  verified: boolean;
}

/**
 * A03: shows whether the account email is verified, sends a new verification
 * link, and lists travel-agent memberships that still need a fresh invitation.
 */
export function EmailVerificationCard({
  emailVerified,
  memberships,
}: {
  emailVerified: boolean;
  memberships: MembershipRow[];
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/verify-email/resend", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Gagal mengirim tautan verifikasi");
        return;
      }
      setMessage(
        data?.alreadyVerified
          ? "Email Anda sudah terverifikasi."
          : "Tautan verifikasi dikirim ke email Anda. Tautan berlaku 24 jam.",
      );
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setBusy(false);
    }
  }

  const unverified = memberships.filter((m) => !m.verified);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verifikasi email</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {emailVerified ? (
          <p className="flex items-center gap-2 text-foreground">
            <CheckCircle className="text-brand-600" /> Email terverifikasi.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="flex gap-2 text-muted">
              <Info className="mt-1 shrink-0" />
              Email belum terverifikasi. Buka tautan verifikasi yang kami kirim ke email Anda.
            </p>
            <Button type="button" variant="outline" disabled={busy} onClick={resend}>
              {busy ? "Mengirim..." : "Kirim ulang tautan verifikasi"}
            </Button>
          </div>
        )}
        {message ? <p role="status" className="text-status-online">{message}</p> : null}
        {error ? <p role="alert" className="text-status-error">{error}</p> : null}
        {unverified.length > 0 ? (
          <div className="space-y-1 rounded-xl border border-border bg-surface/50 p-3">
            <p className="font-semibold text-foreground">Akses travel agent menunggu verifikasi</p>
            <p className="text-muted">
              Trip rombongan dari travel agent berikut baru terlihat setelah Anda menerima undangan
              baru dari email undangan. Minta admin organisasi mengirim ulang undangan.
            </p>
            <ul className="list-disc pl-5 text-muted">
              {unverified.map((m) => (
                <li key={m.travelAgentId}>{m.travelAgentName}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
