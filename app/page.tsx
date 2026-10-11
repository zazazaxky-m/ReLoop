import type { Metadata } from "next";
import { BrandLogo } from "@/components/BrandLogo";
import Link from "next/link";
import { buttonVariants } from "@/components/ui";
import { HeroCarousel } from "@/components/landing/HeroCarousel";
import { CONFIG_KEYS, getConfig } from "@/lib/config";
import { parseHeroSlides } from "@/lib/hero-slides";
import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import {
  ArrowRight,
  CheckCircle,
  Coins,
  Leaf,
  QrCode,
  Recycle,
  ShieldCheck,
  Truck,
  Wallet,
} from "@/components/ui/icons";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export const revalidate = 300;

const HOME_TITLE = `${SITE_NAME} — Bank Sampah Digital: Setor Sampah, Dapat Reward`;

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    title: HOME_TITLE,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    locale: "id_ID",
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE,
    description: SITE_DESCRIPTION,
  },
};

function homeJsonLd() {
  const url = absoluteUrl("/");
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${url}#organization`,
        name: SITE_NAME,
        url,
        logo: absoluteUrl("/icons/icon-512.png"),
        description: SITE_DESCRIPTION,
      },
      {
        "@type": "WebSite",
        "@id": `${url}#website`,
        name: SITE_NAME,
        url,
        inLanguage: "id-ID",
        publisher: { "@id": `${url}#organization` },
      },
    ],
  };
}

const steps = [
  {
    icon: QrCode,
    number: "01",
    title: "Pindai QR mesin",
    desc: "Buka aplikasi ReLoop, lalu pindai kode QR di layar mesin ReLoop terdekat.",
  },
  {
    icon: Coins,
    number: "02",
    title: "Masukkan sampah",
    desc: "Mesin mendeteksi jenis dan berat sampahmu, lalu poin langsung masuk ke akun.",
  },
  {
    icon: Wallet,
    number: "03",
    title: "Cairkan poin",
    desc: "Tukar poin ke e-wallet atau rekening bank, dan pantau status pencairannya.",
  },
];

const ecosystem = [
  "Warga setor sampah, dapat poin",
  "Pengelola memantau setoran & mesin",
  "Pengepul menjemput sampah terpilah",
];

export default async function Home() {
  const heroSlides = parseHeroSlides(
    await getConfig(CONFIG_KEYS.LANDING_HERO_SLIDES),
  );

  return (
    <div className="min-h-screen overflow-hidden bg-background">
      <script
        type="application/ld+json"
        // JSON-LD data block; escape "<" so values can never close the tag.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(homeJsonLd()).replace(/</g, "\\u003c"),
        }}
      />
      <header className="relative z-30 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-10">
          <Link href="/" className="flex items-center">
            <BrandLogo
              width={138}
              height={41}
              priority
              className="h-10 w-auto"
            />
          </Link>

          <nav className="flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <Link
              href="/login"
              className={buttonVariants({
                variant: "ghost",
                size: "sm",
                className: "rounded-full px-4 text-emerald-950 dark:text-emerald-100",
              })}
            >
              Masuk
            </Link>
            <Link
              href="/register"
              className={buttonVariants({
                variant: "primary",
                size: "sm",
                className:
                  "rounded-full bg-emerald-950 px-5 shadow-none hover:bg-emerald-800",
              })}
            >
              Daftar
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative isolate">
          <div className="pointer-events-none absolute -left-32 top-10 -z-10 h-96 w-96 rounded-full bg-lime-200/35 blur-3xl" />
          <div className="pointer-events-none absolute right-0 top-0 -z-10 h-[34rem] w-[34rem] rounded-full bg-emerald-200/30 blur-3xl" />

          <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-5 pb-14 pt-7 sm:px-8 sm:pt-9 lg:grid-cols-[1.02fr_.98fr] lg:px-10 lg:pb-20 lg:pt-10">
            <div className="relative z-10 min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-900/10 dark:border-emerald-900/30 bg-white/75 dark:bg-emerald-950/20 px-3.5 py-2 text-xs font-bold uppercase tracking-[0.13em] text-emerald-800 dark:text-emerald-400 shadow-sm backdrop-blur">
                <Leaf className="text-base" />
                Bank sampah digital
              </div>

              <h1 className="mt-7 max-w-3xl text-[2.85rem] font-black leading-[0.94] tracking-[-0.065em] text-emerald-950 dark:text-emerald-100 min-[370px]:text-[3.15rem] sm:text-7xl lg:text-[5.35rem]">
                Setor sampah.
                <span className="mt-2 block text-emerald-600">
                  Dapat reward.
                </span>
              </h1>

              <p className="mt-7 max-w-xl text-base leading-7 text-muted sm:text-lg sm:leading-8">
                Pindai QR di mesin ReLoop, masukkan sampahmu, dan poin langsung
                masuk ke akun. Cairkan ke GoPay, OVO, DANA, ShopeePay, atau
                rekening bank.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/register"
                  className={buttonVariants({
                    variant: "primary",
                    size: "lg",
                    className:
                      "h-14 rounded-full bg-emerald-700 px-7 shadow-[0_12px_30px_rgba(4,120,87,0.24)] hover:bg-emerald-800 dark:bg-brand-600 dark:hover:bg-brand-500",
                  })}
                >
                  Daftar gratis <ArrowRight />
                </Link>
                <Link
                  href="/login"
                  className={buttonVariants({
                    variant: "outline",
                    size: "lg",
                    className:
                      "h-14 rounded-full border-emerald-950/10 dark:border-border bg-white/70 dark:bg-surface/70 px-7 shadow-none backdrop-blur hover:bg-white dark:hover:bg-surface",
                  })}
                >
                  Masuk ke akun
                </Link>
              </div>

              <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold text-muted">
                <span className="flex items-center gap-2">
                  <CheckCircle className="text-lg text-emerald-600" />
                  Setiap setoran tercatat
                </span>
                <span className="flex items-center gap-2">
                  <CheckCircle className="text-lg text-emerald-600" />
                  Poin bisa dicairkan
                </span>
              </div>
            </div>

            <div className="mx-auto min-w-0 w-full max-w-xl lg:max-w-none">
              <HeroCarousel slides={heroSlides} />
            </div>
          </div>
        </section>

        <section className="px-5 py-8 sm:px-8 lg:px-10">
          <div className="mx-auto grid max-w-7xl overflow-hidden rounded-[2rem] bg-emerald-950 text-white lg:grid-cols-[.8fr_1.2fr]">
            <div className="relative overflow-hidden p-8 sm:p-10 lg:p-12">
              <div className="absolute -bottom-24 -right-20 h-64 w-64 rounded-full border-[45px] border-lime-300/10" />
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-lime-300">
                Cara kerja
              </p>
              <h2 className="mt-4 max-w-md text-3xl font-black leading-tight tracking-[-0.045em] sm:text-4xl">
                Tiga langkah dari sampah jadi saldo.
              </h2>
              <p className="mt-4 max-w-sm leading-7 text-white/80">
                Tanpa timbang manual. Setiap setoran tercatat otomatis oleh
                mesin.
              </p>
            </div>

            <div className="grid border-t border-white/10 sm:grid-cols-3 lg:border-l lg:border-t-0">
              {steps.map((step, index) => (
                <article
                  key={step.title}
                  className={`group p-7 transition-colors hover:bg-white/[0.06] sm:p-8 ${
                    index
                      ? "border-t border-white/10 sm:border-l sm:border-t-0"
                      : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-lime-300 text-xl text-emerald-950">
                      <step.icon />
                    </span>
                    <span className="text-xs font-bold tracking-[0.15em] text-white/40">
                      {step.number}
                    </span>
                  </div>
                  <h3 className="mt-8 text-lg font-bold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-white/75">
                    {step.desc}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:px-10 lg:py-28">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-600">
              Satu sistem, semua peran
            </p>
            <h2 className="mt-4 max-w-xl text-4xl font-black leading-[1.05] tracking-[-0.05em] text-emerald-950 dark:text-emerald-100 sm:text-5xl">
              Dari botolmu sampai pabrik daur ulang.
            </h2>
          </div>

          <div className="lg:pt-3">
            <p className="max-w-xl text-base leading-7 text-muted sm:text-lg sm:leading-8">
              Pengelola wisata dan bank sampah mengumpulkan setoran, pengepul
              menjemputnya saat gudang penuh. Setiap kilogram tercatat di satu
              sistem yang sama.
            </p>
            <div className="mt-8 space-y-3">
              {ecosystem.map((item, index) => {
                const Icon = [Recycle, ShieldCheck, Truck][index];
                return (
                  <div
                    key={item}
                    className="flex items-center gap-4 rounded-2xl border border-emerald-950/8 dark:border-border bg-surface p-4 shadow-[0_8px_30px_rgba(6,78,59,0.05)] dark:shadow-none"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-xl text-emerald-700 dark:bg-brand-950/20 dark:text-brand-400">
                      <Icon />
                    </span>
                    <p className="font-bold text-foreground">{item}</p>
                    <ArrowRight className="ml-auto text-emerald-900/25 dark:text-muted-soft" />
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="px-5 pb-8 sm:px-8 lg:px-10 lg:pb-10">
          <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-lime-300 px-7 py-12 dark:bg-brand-600 sm:px-12 sm:py-16 lg:flex lg:items-center lg:justify-between">
            <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full border-[55px] border-emerald-950/5 dark:border-brand-950/30" />
            <div className="relative">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800 dark:text-brand-100">
                Giliranmu ikut memutar
              </p>
              <h2 className="mt-3 max-w-2xl text-3xl font-black leading-tight tracking-[-0.045em] text-emerald-950 dark:text-white sm:text-5xl">
                Botol pertamamu, poin pertamamu.
              </h2>
            </div>
            <Link
              href="/register"
              className={buttonVariants({
                variant: "primary",
                size: "lg",
                className:
                  "relative mt-8 h-14 rounded-full bg-emerald-950 px-7 shadow-none hover:bg-emerald-800 dark:bg-brand-950 dark:hover:bg-brand-900 lg:mt-0",
              })}
            >
              Buat akun gratis <ArrowRight />
            </Link>
          </div>
        </section>
      </main>

      <footer className="px-5 py-8 sm:px-8 lg:px-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 border-t border-border pt-7 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <BrandLogo
            width={112}
            height={34}
            className="h-8 w-auto"
          />
          <p>Sampah selesai. Dampak dimulai.</p>
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
            <nav aria-label="Tautan legal" className="flex items-center gap-4">
              <Link
                href="/privacy"
                className="font-semibold text-muted transition-colors hover:text-brand-700 dark:hover:text-brand-400"
              >
                Kebijakan Privasi
              </Link>
              <Link
                href="/terms"
                className="font-semibold text-muted transition-colors hover:text-brand-700 dark:hover:text-brand-400"
              >
                Syarat &amp; Ketentuan
              </Link>
            </nav>
            <p>&copy; {new Date().getFullYear()} ReLoop</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
