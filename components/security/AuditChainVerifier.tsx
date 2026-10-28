"use client";

import { useState } from "react";
import { Button, Card, CardContent } from "@/components/ui";

type LegacyStatus = "not-present" | "unverifiable" | "valid";
type LegacyCheckpoint = "not-required" | "missing" | "matches" | "mismatch";
type ChainBreak = "version" | "sequence" | "previous-hash" | "checksum";

/** POST /api/audit/verify: `valid` covers the new chain only; the legacy archive is separate. */
export type AuditVerifyResult = {
  valid: boolean;
  brokenAt?: string;
  reason?: ChainBreak;
  checkedVersion?: number;
  checkedCount?: number;
  legacyStatus?: LegacyStatus;
  legacyCount?: number;
  legacyCheckpoint?: LegacyCheckpoint;
};

type Tone = "ok" | "warn" | "muted";
type Line = { label: string; text: string; tone: Tone };

const BREAK_TEXT: Record<ChainBreak, string> = {
  version: "versi rantai tidak dikenal",
  sequence: "nomor urut terputus atau tidak berurutan",
  "previous-hash": "tautan ke entri sebelumnya tidak cocok",
  checksum: "isi entri tidak cocok dengan checksum-nya",
};

const TONE_CLASS: Record<Tone, string> = {
  ok: "text-brand-700",
  warn: "text-amber-700 dark:text-amber-400",
  muted: "text-muted",
};

/** The verification as separate lines: new chain, legacy archive, and its checkpoint. */
export function describeAuditVerification(result: AuditVerifyResult): Line[] {
  const lines: Line[] = [];
  const checked = result.checkedCount ?? 0;
  lines.push(
    result.valid
      ? { label: "Rantai audit baru", text: `Valid. ${checked} entri diperiksa sesuai nomor urut.`, tone: "ok" }
      : {
          label: "Rantai audit baru",
          text: `Rusak pada entri ${result.brokenAt ?? "tidak diketahui"}${result.reason ? `: ${BREAK_TEXT[result.reason]}` : ""}.`,
          tone: "warn",
        },
  );

  const legacyLabel = "Arsip audit lama";
  const legacyCount = result.legacyCount ?? 0;
  if (result.legacyStatus === "not-present") {
    lines.push({ label: legacyLabel, text: "Tidak ada entri lama.", tone: "muted" });
  } else if (result.legacyStatus === "valid") {
    lines.push({
      label: legacyLabel,
      text: `${legacyCount} entri lama cocok dengan checksum yang tersimpan. Dilaporkan terpisah dari rantai baru.`,
      tone: "ok",
    });
  } else if (result.legacyStatus === "unverifiable") {
    lines.push({
      label: legacyLabel,
      text:
        `${legacyCount} entri lama tidak dapat diverifikasi. Arsip disimpan apa adanya dan tidak ditandatangani ulang, ` +
        "jadi keasliannya tidak dapat dibuktikan. Status ini tidak memengaruhi validitas rantai baru.",
      tone: "warn",
    });
  }

  if (result.legacyCheckpoint === "matches") {
    lines.push({ label: "Checkpoint arsip lama", text: "Arsip lama tidak berubah sejak checkpoint dicatat.", tone: "ok" });
  } else if (result.legacyCheckpoint === "missing") {
    lines.push({ label: "Checkpoint arsip lama", text: "Checkpoint arsip lama belum dicatat.", tone: "warn" });
  } else if (result.legacyCheckpoint === "mismatch") {
    lines.push({
      label: "Checkpoint arsip lama",
      text: "Arsip lama berubah sejak checkpoint dicatat. Laporkan ke tim keamanan.",
      tone: "warn",
    });
  }
  return lines;
}

export function AuditChainResult({ result }: { result: AuditVerifyResult }) {
  return (
    <dl className="mt-2 space-y-1 text-sm">
      {describeAuditVerification(result).map((line) => (
        <div key={line.label}>
          <dt className="inline font-medium text-foreground">{line.label}: </dt>
          <dd className={`inline font-medium ${TONE_CLASS[line.tone]}`}>{line.text}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AuditChainVerifier() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AuditVerifyResult | null>(null);
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
      setResult(data as AuditVerifyResult);
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
            Verifikasi rantai audit sesuai nomor urut untuk mendeteksi manipulasi. Arsip audit lama dilaporkan terpisah.
          </p>
          {result ? <AuditChainResult result={result} /> : null}
          {error ? <p className="mt-2 text-sm text-status-error">{error}</p> : null}
        </div>
        <Button type="button" onClick={runVerify} disabled={loading}>
          {loading ? "Memverifikasi…" : "Verifikasi rantai"}
        </Button>
      </CardContent>
    </Card>
  );
}
