"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui";
import { ArrowRight, CheckCircle, Info } from "@/components/ui/icons";
import { forgetLinkToken, takeLinkToken, type LinkTokenKind } from "@/lib/link-token";

interface Copy {
  endpoint: string;
  path: string;
  action: string;
  busy: string;
  doneTitle: string;
  doneBody: string;
  doneHref: string;
  doneLink: string;
  signInBody: string;
  missing: string;
}

const COPY: Record<LinkTokenKind, Copy> = {
  "accept-invitation": {
    endpoint: "/api/travel-agent-invitations/accept",
    path: "/accept-invitation",
    action: "Terima undangan",
    busy: "Memproses...",
    doneTitle: "Undangan diterima",
    doneBody: "Akun Anda sekarang terhubung ke travel agent ini dan dapat melihat trip rombongannya.",
    doneHref: "/dashboard/user/trash-bag",
    doneLink: "Buka trip rombongan",
    signInBody:
      "Masuk atau daftar memakai alamat email yang menerima undangan, lalu Anda akan kembali ke halaman ini.",
    missing: "Tautan undangan tidak lengkap. Buka tautan terbaru dari email undangan.",
  },
  "verify-email": {
    endpoint: "/api/auth/verify-email",
    path: "/verify-email",
    action: "Verifikasi email",
    busy: "Memverifikasi...",
    doneTitle: "Email terverifikasi",
    doneBody: "Alamat email akun Anda sudah terverifikasi.",
    doneHref: "/dashboard",
    doneLink: "Buka dashboard",
    signInBody: "Masuk ke akun yang menerima email verifikasi, lalu Anda akan kembali ke halaman ini.",
    missing: "Tautan verifikasi tidak lengkap. Buka tautan terbaru dari email Anda, atau kirim ulang dari halaman profil.",
  },
};

type State =
  | { phase: "loading" }
  | { phase: "missing" }
  | { phase: "signed-out" }
  | { phase: "ready"; email: string }
  | { phase: "done" };

/**
 * Uses an emailed single-use token (A03). The token was moved out of the URL
 * by the page's inline capture script; it is sent only in a POST body, only
 * after the signed-in user clicks, and never shown or logged.
 */
export function EmailTokenAction({ kind }: { kind: LinkTokenKind }) {
  const copy = COPY[kind];
  // The token never needs to render; it stays out of React state.
  const tokenRef = useRef<string | null>(null);
  const [state, setState] = useState<State>({ phase: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const found = takeLinkToken(kind);
    tokenRef.current = found;
    let cancelled = false;
    const next: Promise<State> = found
      ? fetch("/api/auth/me", { headers: { accept: "application/json" }, referrerPolicy: "same-origin" })
          .then(async (res): Promise<State> => {
            if (!res.ok) return { phase: "signed-out" };
            const data = await res.json().catch(() => null);
            return { phase: "ready", email: String(data?.user?.email ?? "") };
          })
          .catch((): State => ({ phase: "signed-out" }))
      : Promise.resolve({ phase: "missing" });
    void next.then((value) => {
      if (!cancelled) setState(value);
    });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  async function submit() {
    const token = tokenRef.current;
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(copy.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({ token }),
        // Under the page's no-referrer policy the Fetch spec sends `Origin:
        // null` on a POST (Firefox does), which proxy.ts's same-origin check
        // refuses. This same-origin call may name its origin; its URL and the
        // page URL carry no token.
        referrerPolicy: "same-origin",
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        forgetLinkToken(kind);
        setState({ phase: "done" });
        return;
      }
      // Unknown, used and expired tokens never work again; a different
      // account (403) may still use it after signing in with the right one.
      if ([400, 409, 410, 422].includes(res.status)) forgetLinkToken(kind);
      if (res.status === 401) {
        setState({ phase: "signed-out" });
        return;
      }
      setError(data?.error ?? "Terjadi kesalahan");
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setBusy(false);
    }
  }

  if (state.phase === "loading") {
    return <p className="text-sm text-muted">Memeriksa tautan...</p>;
  }

  if (state.phase === "missing") {
    return (
      <p role="alert" className="text-sm leading-6 text-status-error">
        {copy.missing}
      </p>
    );
  }

  if (state.phase === "done") {
    return (
      <div className="space-y-4 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-lime text-ink">
          <CheckCircle className="text-2xl" />
        </span>
        <h2 className="text-xl font-bold tracking-[-0.03em] text-foreground">{copy.doneTitle}</h2>
        <p className="text-sm leading-6 text-muted">{copy.doneBody}</p>
        <Link href={copy.doneHref} className="inline-flex text-sm font-bold text-foreground underline decoration-1 underline-offset-4 hover:decoration-2">
          {copy.doneLink}
        </Link>
      </div>
    );
  }

  if (state.phase === "signed-out") {
    const next = encodeURIComponent(copy.path);
    return (
      <div className="space-y-4">
        <p className="flex gap-2 text-sm leading-6 text-muted">
          <Info className="mt-1 shrink-0" />
          {copy.signInBody}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link
            href={`/login?next=${next}`}
            className={buttonVariants({ size: "lg", className: "flex-1" })}
          >
            Masuk
          </Link>
          {kind === "accept-invitation" ? (
            <Link
              href={`/register?next=${next}`}
              className={buttonVariants({ variant: "outline", size: "lg", className: "flex-1 border-foreground" })}
            >
              Daftar
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error dark:border-red-900/30 dark:bg-red-950/20"
        >
          {error}
        </div>
      ) : null}
      <p className="text-sm leading-6 text-muted">
        Masuk sebagai <span className="font-semibold text-foreground">{state.email}</span>.
        {kind === "accept-invitation"
          ? " Undangan hanya dapat diterima oleh akun yang memakai alamat email undangan."
          : null}
      </p>
      <Button type="button" size="lg" className="h-13 w-full justify-between" disabled={busy} onClick={submit}>
        {busy ? copy.busy : copy.action}
        {busy ? null : <ArrowRight className="text-lg" />}
      </Button>
    </div>
  );
}
