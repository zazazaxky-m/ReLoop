import Image from "next/image";
import Link from "next/link";
import { buttonVariants } from "@/components/ui";
import { HeroCarousel } from "@/components/landing/HeroCarousel";
import { CONFIG_KEYS, getConfig } from "@/lib/config";
import { parseHeroSlides } from "@/lib/hero-slides";
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

export const dynamic = "force-dynamic";

const steps = [
  {
    icon: QrCode,
    number: "01",
    title: "Pindai & setor",
    desc: "Temukan titik ReLoop terdekat, pindai kode, lalu setorkan material.",
  },
  {
    icon: Coins,
    number: "02",
    title: "Dapatkan nilai",
    desc: "Setiap setoran tervalidasi dan reward langsung tercatat di akunmu.",
  },
  {
    icon: Wallet,
    number: "03",
    title: "Gunakan reward",
    desc: "Pantau saldo dan ajukan pencairan dengan proses yang transparan.",
  },
];

const ecosystem = [
  "Warga menyetor lebih mudah",
  "Organisasi memantau dampak",
  "Pengepul bekerja lebih terarah",
];

export default async function Home() {
  const heroSlides = parseHeroSlides(
    await getConfig(CONFIG_KEYS.LANDING_HERO_SLIDES),
  );

  return (
    <div className="min-h-screen overflow-hidden bg-[#f7faf7]">
      <header className="relative z-30 border-b border-emerald-950/5 bg-[#f7faf7]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-10">
          <Link href="/" className="flex items-center">
            <Image
              src="/reloop-logo-name.svg"
              alt="ReLoop"
              width={138}
              height={41}
              priority
              className="h-10 w-auto"
            />
          </Link>

          <nav className="flex items-center gap-1 sm:gap-2">
            <Link
              href="/login"
              className={buttonVariants({
                variant: "ghost",
                size: "sm",
                className: "rounded-full px-4 text-emerald-950",
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
              Mulai
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
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-900/10 bg-white/75 px-3.5 py-2 text-xs font-bold uppercase tracking-[0.13em] text-emerald-800 shadow-sm backdrop-blur">
                <Leaf className="text-base" />
                Satu aksi, dampak berulang
              </div>

              <h1 className="mt-7 max-w-3xl text-[2.85rem] font-black leading-[0.94] tracking-[-0.065em] text-emerald-950 min-[370px]:text-[3.15rem] sm:text-7xl lg:text-[5.35rem]">
                Sampah selesai.
                <span className="mt-2 block text-emerald-600">
                  Dampak dimulai.
                </span>
              </h1>

              <p className="mt-7 max-w-xl text-base leading-7 text-emerald-950/62 sm:text-lg sm:leading-8">
                ReLoop membuat setoran, reward, dan pengambilan material bergerak
                dalam satu alur yang sederhana—untuk warga, komunitas, dan kota.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/register"
                  className={buttonVariants({
                    variant: "primary",
                    size: "lg",
                    className:
                      "h-14 rounded-full bg-emerald-700 px-7 shadow-[0_12px_30px_rgba(4,120,87,0.24)] hover:bg-emerald-800",
                  })}
                >
                  Mulai setor <ArrowRight />
                </Link>
                <Link
                  href="/login"
                  className={buttonVariants({
                    variant: "outline",
                    size: "lg",
                    className:
                      "h-14 rounded-full border-emerald-950/10 bg-white/70 px-7 shadow-none backdrop-blur hover:bg-white",
                  })}
                >
                  Buka dashboard
                </Link>
              </div>

              <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold text-emerald-950/65">
                <span className="flex items-center gap-2">
                  <CheckCircle className="text-lg text-emerald-600" />
                  Reward transparan
                </span>
                <span className="flex items-center gap-2">
                  <CheckCircle className="text-lg text-emerald-600" />
                  Dampak tercatat
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
                Sesederhana itu
              </p>
              <h2 className="mt-4 max-w-md text-3xl font-black leading-tight tracking-[-0.045em] sm:text-4xl">
                Dari barang bekas menjadi nilai baru.
              </h2>
              <p className="mt-4 max-w-sm leading-7 text-white/58">
                Tanpa alur rumit. Setiap langkah terasa jelas dari awal sampai
                reward masuk.
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
                    <span className="text-xs font-bold tracking-[0.15em] text-white/25">
                      {step.number}
                    </span>
                  </div>
                  <h3 className="mt-8 text-lg font-bold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-white/52">
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
              Dibangun untuk bergerak bersama
            </p>
            <h2 className="mt-4 max-w-xl text-4xl font-black leading-[1.05] tracking-[-0.05em] text-emerald-950 sm:text-5xl">
              Semua orang punya peran dalam satu putaran.
            </h2>
          </div>

          <div className="lg:pt-3">
            <p className="max-w-xl text-base leading-7 text-emerald-950/60 sm:text-lg sm:leading-8">
              Dari setoran harian hingga pengangkutan skala organisasi, ReLoop
              menjaga data dan pekerjaan tetap terhubung.
            </p>
            <div className="mt-8 space-y-3">
              {ecosystem.map((item, index) => {
                const Icon = [Recycle, ShieldCheck, Truck][index];
                return (
                  <div
                    key={item}
                    className="flex items-center gap-4 rounded-2xl border border-emerald-950/8 bg-white p-4 shadow-[0_8px_30px_rgba(6,78,59,0.05)]"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-xl text-emerald-700">
                      <Icon />
                    </span>
                    <p className="font-bold text-emerald-950">{item}</p>
                    <ArrowRight className="ml-auto text-emerald-900/25" />
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="px-5 pb-8 sm:px-8 lg:px-10 lg:pb-10">
          <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-lime-300 px-7 py-12 sm:px-12 sm:py-16 lg:flex lg:items-center lg:justify-between">
            <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full border-[55px] border-emerald-950/5" />
            <div className="relative">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">
                Giliranmu ikut memutar
              </p>
              <h2 className="mt-3 max-w-2xl text-3xl font-black leading-tight tracking-[-0.045em] text-emerald-950 sm:text-5xl">
                Mulai dari satu setoran hari ini.
              </h2>
            </div>
            <Link
              href="/register"
              className={buttonVariants({
                variant: "primary",
                size: "lg",
                className:
                  "relative mt-8 h-14 rounded-full bg-emerald-950 px-7 shadow-none hover:bg-emerald-800 lg:mt-0",
              })}
            >
              Buat akun gratis <ArrowRight />
            </Link>
          </div>
        </section>
      </main>

      <footer className="px-5 py-8 sm:px-8 lg:px-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 border-t border-emerald-950/8 pt-7 text-sm text-emerald-950/48 sm:flex-row sm:items-center sm:justify-between">
          <Image
            src="/reloop-logo-name.svg"
            alt="ReLoop"
            width={112}
            height={34}
            className="h-8 w-auto"
          />
          <p>Pengelolaan sampah yang kembali memberi nilai.</p>
          <p>&copy; {new Date().getFullYear()} ReLoop</p>
        </div>
      </footer>
    </div>
  );
}
