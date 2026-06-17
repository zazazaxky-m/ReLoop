import Link from "next/link";
import { buttonVariants } from "@/components/ui";
import {
  ArrowRight,
  Building,
  Coins,
  Leaf,
  QrCode,
  Recycle,
  ShieldCheck,
  Truck,
  User,
  Wallet,
} from "@/components/ui/icons";

const steps = [
  {
    icon: QrCode,
    title: "Scan QR Mesin",
    desc: "Pindai QR dinamis pada layar mesin kolektor untuk memulai sesi setor.",
  },
  {
    icon: Recycle,
    title: "Masukkan Sampah",
    desc: "Botol & kaleng divalidasi via berat, kamera AI, dan acceptance point.",
  },
  {
    icon: Coins,
    title: "Dapat Reward",
    desc: "Reward per item tercatat di ledger internal setelah barang diterima.",
  },
  {
    icon: Wallet,
    title: "Cairkan Saldo",
    desc: "Tarik saldo ke e-wallet via transfer manual superadmin.",
  },
];

const roles = [
  {
    icon: User,
    title: "Pengguna",
    desc: "Setor sampah, lihat saldo & riwayat, ikuti campaign, cairkan reward.",
  },
  {
    icon: Building,
    title: "Admin Organisasi",
    desc: "Kelola mesin, campaign, jenis sampah, dan mitra pengepul organisasi.",
  },
  {
    icon: Truck,
    title: "Pengepul",
    desc: "Pantau mesin penuh & tugas pickup pada organisasi mitra aktif.",
  },
  {
    icon: ShieldCheck,
    title: "Superadmin",
    desc: "Kelola tenant, wilayah, kemitraan, payout, dan laporan lintas daerah.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-lg text-white">
              <Recycle />
            </span>
            <div className="leading-tight">
              <p className="text-base font-bold text-foreground">ReLoop</p>
              <p className="text-[11px] font-medium text-muted">
                Smart Waste Bank Pangandaran
              </p>
            </div>
          </div>
          <nav className="flex items-center gap-2">
            <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Masuk
            </Link>
            <Link href="/register" className={buttonVariants({ variant: "primary", size: "sm" })}>
              Daftar
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-brand-50 via-mint-soft to-background" />
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
          <div className="space-y-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-mint px-3 py-1 text-sm font-medium text-brand-700">
              <Leaf className="text-base" /> Mulai dari Kabupaten Pangandaran
            </span>
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl">
              Setor sampah, dapat{" "}
              <span className="text-brand-600">reward</span>, jaga bumi.
            </h1>
            <p className="max-w-xl text-lg text-muted">
              Platform manajemen sampah end-to-end: mesin kolektor pintar,
              reward pengguna, campaign lingkungan, dan operasional pengepul
              dalam satu sistem.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/register"
                className={buttonVariants({ variant: "primary", size: "lg" })}
              >
                Mulai Sekarang <ArrowRight />
              </Link>
              <Link
                href="/login"
                className={buttonVariants({ variant: "outline", size: "lg" })}
              >
                Masuk ke Dashboard
              </Link>
            </div>
          </div>

          {/* Hero visual: machine mock */}
          <div className="relative mx-auto w-full max-w-sm">
            <div className="rounded-3xl border border-border bg-surface p-6 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white">
                    <Recycle />
                  </span>
                  <div className="leading-tight">
                    <p className="text-sm font-semibold">Mesin RLP-001</p>
                    <p className="text-xs text-muted">Pantai Pangandaran</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700">
                  <span className="h-2 w-2 rounded-full bg-brand-500" /> Online
                </span>
              </div>
              <div className="mt-5 flex aspect-square items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white">
                <QrCode className="text-7xl" />
              </div>
              <p className="mt-3 text-center text-xs text-muted">
                QR dinamis &middot; berotasi setiap 30 detik
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-brand-50 p-3 text-center">
                  <p className="text-xs text-muted">Botol</p>
                  <p className="text-base font-bold text-brand-700">Rp200</p>
                </div>
                <div className="rounded-xl bg-brand-50 p-3 text-center">
                  <p className="text-xs text-muted">Kaleng</p>
                  <p className="text-base font-bold text-brand-700">Rp250</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Cara kerjanya
          </h2>
          <p className="mt-2 text-muted">
            Empat langkah sederhana dari setor sampah hingga cair reward.
          </p>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <div
              key={s.title}
              className="relative rounded-2xl border border-border bg-surface p-6 shadow-sm"
            >
              <span className="absolute right-5 top-5 text-3xl font-bold text-brand-100">
                {i + 1}
              </span>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-2xl text-brand-600">
                <s.icon />
              </span>
              <h3 className="mt-4 font-semibold text-foreground">{s.title}</h3>
              <p className="mt-1 text-sm text-muted">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Roles */}
      <section className="bg-brand-50/50 py-16">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Satu platform, empat peran
            </h2>
            <p className="mt-2 text-muted">
              Akses dibatasi server-side dengan RBAC, tenant isolation, dan
              kemitraan pengepul.
            </p>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {roles.map((r) => (
              <div
                key={r.title}
                className="rounded-2xl border border-border bg-surface p-6 shadow-sm"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500 text-2xl text-white">
                  <r.icon />
                </span>
                <h3 className="mt-4 font-semibold text-foreground">
                  {r.title}
                </h3>
                <p className="mt-1 text-sm text-muted">{r.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA banner */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 to-brand-800 px-8 py-12 text-center text-white sm:px-12">
          <h2 className="text-2xl font-bold sm:text-3xl">
            Dari Pangandaran untuk Jawa Barat
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-brand-50">
            Model wilayah siap diperluas dari kabupaten ke provinsi. Bergabung
            dan jadikan pengelolaan sampah lebih bersih dan terukur.
          </p>
          <Link
            href="/register"
            className={buttonVariants({
              variant: "secondary",
              size: "lg",
              className: "mt-6",
            })}
          >
            Buat Akun Gratis <ArrowRight />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-muted sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500 text-sm text-white">
              <Recycle />
            </span>
            <span className="font-semibold text-foreground">ReLoop</span>
            <span>&middot; Smart Waste Bank Pangandaran</span>
          </div>
          <p>MVP &middot; {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
}
