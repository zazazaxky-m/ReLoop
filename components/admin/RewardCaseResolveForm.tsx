"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Label, Textarea } from "@/components/ui";
import { formatRupiah } from "@/lib/format";

type ErrorBody = { error?: unknown; issues?: { message?: unknown }[] } | null;

function errorMessage(body: ErrorBody): string {
  const issue = body?.issues?.[0]?.message;
  if (typeof issue === "string") return issue;
  if (typeof body?.error === "string") return body.error;
  return "Gagal menyelesaikan kasus. Coba lagi.";
}

/**
 * SUPERADMIN closes one reward reconciliation case with a written outcome
 * (POST /api/reward-cases/[id]/resolve). The ledger is never changed.
 */
export function RewardCaseResolveForm({
  caseId,
  holdsWithdrawals,
  releasedIfResolved,
}: {
  caseId: string;
  holdsWithdrawals: boolean;
  /** Rupiah resolving makes withdrawable for the owner right now (reconciliation report). */
  releasedIfResolved: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const noteId = `${id}-note`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  useEffect(() => {
    if (open) document.getElementById(noteId)?.focus();
  }, [open, noteId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/reward-cases/${caseId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) {
        setError(errorMessage(await res.json().catch(() => null)));
        return;
      }
      setOpen(false);
      setNote("");
      router.refresh();
    } catch {
      setError("Tidak dapat terhubung ke server. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Selesaikan
      </Button>
    );
  }

  return (
    <form onSubmit={submit} aria-label="Selesaikan kasus rekonsiliasi" className="min-w-[16rem] space-y-2">
      <Label htmlFor={noteId}>Hasil penanganan</Label>
      <Textarea
        id={noteId}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={500}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
      />
      <p id={hintId} className="text-xs text-muted">
        {holdsWithdrawals && releasedIfResolved > 0
          ? `Menyelesaikan kasus ini membuat ${formatRupiah(releasedIfResolved)} dari saldo pengguna dapat dicairkan. Lakukan hanya bila dana itu memang hak pengguna atau sudah dipulihkan; ledger tidak diubah. `
          : holdsWithdrawals
            ? "Menyelesaikan kasus ini tidak mengubah saldo yang dapat dicairkan pengguna saat ini; ledger tidak diubah. "
            : "Ledger tidak diubah. "}
        Tulis hasil penanganan, misalnya setoran ternyata sah, dana sudah dipulihkan, atau dihapusbukukan (minimal 10
        karakter). Jangan tulis nomor rekening atau data pribadi.
      </p>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          Simpan penyelesaian
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setNote("");
            setError(null);
          }}
        >
          Batal
        </Button>
      </div>
    </form>
  );
}
