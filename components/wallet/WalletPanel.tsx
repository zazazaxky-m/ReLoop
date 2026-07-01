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
  Select,
  StatusBadge,
} from "@/components/ui";
import { Plus } from "@/components/ui/icons";
import { formatDateTime, formatRupiah } from "@/lib/format";

const PROVIDERS = ["GOPAY", "OVO", "SHOPEEPAY", "DANA", "LINKAJA", "BANK", "OTHER"] as const;

export interface AccountRow {
  id: string;
  provider: string;
  accountIdentifier: string;
  accountName: string | null;
  status: string;
}

export interface RedemptionRow {
  id: string;
  amount: number;
  provider: string;
  status: string;
  note: string | null;
  createdAt: string | Date;
}

export function WalletPanel({
  accounts,
  redemptions,
  available,
  minRedemption,
}: {
  accounts: AccountRow[];
  redemptions: RedemptionRow[];
  available: number;
  minRedemption: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const [acc, setAcc] = useState({ provider: "GOPAY", accountIdentifier: "", accountName: "" });

  const [amount, setAmount] = useState("");
  const [payoutAccountId, setPayoutAccountId] = useState(accounts[0]?.id ?? "");

  async function addAccount(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/payout-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: acc.provider,
          accountIdentifier: acc.accountIdentifier,
          accountName: acc.accountName || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d?.error ?? "Gagal menambah akun");
        return;
      }
      setAcc({ provider: "GOPAY", accountIdentifier: "", accountName: "" });
      setAddingAccount(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function disableAccount(id: string) {
    if (!window.confirm("Nonaktifkan akun pencairan ini?")) return;
    setBusy(true);
    try {
      await fetch(`/api/payout-accounts/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function requestRedemption(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/redemptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(amount),
          payoutAccountId,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d?.error ?? "Gagal mengajukan pencairan");
        return;
      }
      setAmount("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function cancelRedemption(id: string) {
    if (!window.confirm("Batalkan pengajuan pencairan ini?")) return;
    setBusy(true);
    try {
      await fetch(`/api/redemptions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const canRedeem = accounts.length > 0 && available >= minRedemption;

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 px-3.5 py-2.5 text-sm text-status-error">
          {error}
        </div>
      ) : null}

      {/* Payout accounts */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Akun Pencairan</CardTitle>
          <Button size="sm" variant={addingAccount ? "outline" : "primary"} onClick={() => setAddingAccount((o) => !o)}>
            {addingAccount ? "Tutup" : <><Plus /> Tambah</>}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {addingAccount ? (
            <form onSubmit={addAccount} className="grid gap-3 sm:grid-cols-3">
              <FormField label="Provider" htmlFor="acc-provider">
                <Select
                  id="acc-provider"
                  value={acc.provider}
                  onChange={(e) => setAcc((a) => ({ ...a, provider: e.target.value }))}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="No. HP / rekening" htmlFor="acc-id" required>
                <Input
                  id="acc-id"
                  value={acc.accountIdentifier}
                  onChange={(e) => setAcc((a) => ({ ...a, accountIdentifier: e.target.value }))}
                  placeholder="0812xxxxxxx"
                  required
                />
              </FormField>
              <FormField label="Nama pemilik" htmlFor="acc-name">
                <Input
                  id="acc-name"
                  value={acc.accountName}
                  onChange={(e) => setAcc((a) => ({ ...a, accountName: e.target.value }))}
                />
              </FormField>
              <div className="sm:col-span-3">
                <Button type="submit" size="sm" disabled={busy}>
                  Simpan Akun
                </Button>
              </div>
            </form>
          ) : null}

          {accounts.length === 0 ? (
            <p className="text-sm text-muted">Belum ada akun pencairan.</p>
          ) : (
            <ul className="divide-y divide-border">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div>
                    <p className="font-medium">
                      {a.provider} · {a.accountIdentifier}
                    </p>
                    {a.accountName ? <p className="text-xs text-muted">{a.accountName}</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={a.status} />
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => disableAccount(a.id)}>
                      Hapus
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Request redemption */}
      <Card>
        <CardHeader>
          <CardTitle>Cairkan Saldo</CardTitle>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted">Tambahkan akun pencairan terlebih dahulu.</p>
          ) : available < minRedemption ? (
            <p className="text-sm text-muted">
              Saldo tersedia {formatRupiah(available)} belum mencapai minimum{" "}
              {formatRupiah(minRedemption)}.
            </p>
          ) : (
            <form onSubmit={requestRedemption} className="grid gap-3 sm:grid-cols-3">
              <FormField label="Jumlah (Rp)" htmlFor="r-amount" required hint={`Maks ${formatRupiah(available)}`}>
                <Input
                  id="r-amount"
                  type="number"
                  min={minRedemption}
                  max={available}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </FormField>
              <FormField label="Ke akun" htmlFor="r-acc">
                <Select id="r-acc" value={payoutAccountId} onChange={(e) => setPayoutAccountId(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.provider} · {a.accountIdentifier}
                    </option>
                  ))}
                </Select>
              </FormField>
              <div className="flex items-end">
                <Button type="submit" disabled={busy || !canRedeem}>
                  {busy ? "Mengajukan..." : "Ajukan Pencairan"}
                </Button>
              </div>
            </form>
          )}
          <p className="mt-3 text-xs text-muted">
            Pencairan diproses oleh pengelola sistem ke akun pembayaran Anda.
          </p>
        </CardContent>
      </Card>

      {/* Redemption history */}
      <Card>
        <CardHeader>
          <CardTitle>Riwayat Pencairan</CardTitle>
        </CardHeader>
        <CardContent>
          {redemptions.length === 0 ? (
            <p className="text-sm text-muted">Belum ada pengajuan pencairan.</p>
          ) : (
            <ul className="divide-y divide-border">
              {redemptions.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <p className="font-medium">
                      {formatRupiah(r.amount)} · {r.provider}
                    </p>
                    <p className="text-xs text-muted">
                      {formatDateTime(r.createdAt)}
                      {r.note ? ` · ${r.note}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={r.status} />
                    {r.status === "REQUESTED" ? (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => cancelRedemption(r.id)}>
                        Batal
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
