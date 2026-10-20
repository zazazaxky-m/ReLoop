"use client";
/* Layered transparent artwork uses measured poster coordinates, not intrinsic image flow. */
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMotionEnvironment } from "./useMotionEnvironment";
import { BottleCoil } from "./BottleCoil";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowDown,
  Recycle,
  QrCode,
  Check,
  X,
  List,
  Play,
  Pause,
  Minus,
  Plus,
  Scan,
  ArrowCounterClockwise,
  BeerBottle,
  Gift,
} from "@phosphor-icons/react";

const assets = "/landing/";
const steps = [
  {
    title: "Pindai QR mesin",
    description:
      "Buka aplikasi ReLoop, lalu pindai kode QR di layar mesin terdekat.",
    icon: QrCode,
  },
  {
    title: "Masukkan sampah",
    description:
      "Mesin mendeteksi jenis dan berat sampahmu, lalu poin langsung masuk ke akun.",
    icon: BeerBottle,
  },
  {
    title: "Cairkan poin",
    description:
      "Tukar poin ke e-wallet atau rekening bank, dan pantau status pencairannya di aplikasi.",
    icon: Gift,
  },
];
const roles = [
  {
    name: "Warga",
    image: "role-warga-v2.webp",
    text: "Setor sampah, kumpulkan poin, dan pilih reward sesuai kebutuhan.",
  },
  {
    name: "Pengelola",
    image: "role-pengelola.webp",
    text: "Mengumpulkan setoran, memantau mesin, dan memastikan sampah diproses dengan benar.",
  },
  {
    name: "Pengepul",
    image: "role-pengepul-v2.webp",
    text: "Menjemput sampah terpilah dari gudang, lalu memasok ke pabrik daur ulang sebagai bahan baku.",
  },
];
function Receipt({
  count = 1,
  success = false,
  compact = false,
}: {
  count?: number;
  success?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`receipt ${success ? "receipt-success" : ""} ${compact ? "compact" : ""}`}
    >
      <div className="receipt-top">
        <img src={assets + "logo.svg"} alt="ReLoop" />
        <span>SIMULASI</span>
      </div>
      <strong>
        SETORAN
        <br />
        TERCATAT.
      </strong>
      <div className="receipt-line">
        <span>
          Botol plastik
          <br />
          <small>PET</small>
        </span>
        <span>{count} pcs</span>
      </div>
      <div className="receipt-total">
        <span>Poin masuk</span>
        <b>+{count * 15} poin</b>
      </div>
      <div className="receipt-thanks">
        <Recycle size={28} weight="bold" />
        <p>
          Terima kasih,
          <br />
          sudah memilih
          <br />
          lingkungan yang lebih baik.
        </p>
      </div>
    </div>
  );
}
export function LandingPage() {
  const [menu, setMenu] = useState(false),
    [userMotion, setMotion] = useState(true),
    [demo, setDemo] = useState(false),
    [stage, setStage] = useState(0),
    [count, setCount] = useState(1),
    [busy, setBusy] = useState(false),
    [redeemed, setRedeemed] = useState(false),
    [method, setMethod] = useState("DANA"),
    [activeStep, setActiveStep] = useState(0),
    [role, setRole] = useState(0);
  const suspended = useMotionEnvironment();
  const motion = userMotion && !suspended;
  const hero = useRef<HTMLElement>(null),
    demoRef = useRef<HTMLElement>(null),
    focusBefore = useRef<HTMLElement | null>(null),
    operationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    );
  const closeDemo = useCallback(() => {
    clearTimeout(operationTimer.current);
    setBusy(false);
    setDemo(false);
  }, []);
  useEffect(() => {
    const els = document.querySelectorAll("[data-reveal]");
    const obs = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("revealed");
            obs.unobserve(e.target);
          }
        }),
      { threshold: 0.12 },
    );
    els.forEach((e) => obs.observe(e));
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    if (!motion || demo) return;
    const id = setInterval(() => setActiveStep((s) => (s + 1) % 3), 4500);
    return () => clearInterval(id);
  }, [motion, demo]);
  useEffect(() => {
    if (!demo) return;
    document.body.classList.add("reloop-demo-open");
    demoRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDemo();
      if (e.key === "Tab") {
        const items = demoRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],select,[tabindex="0"]',
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.classList.remove("reloop-demo-open");
      document.removeEventListener("keydown", key);
      focusBefore.current?.focus();
    };
  }, [demo, closeDemo]);
  useEffect(() => () => clearTimeout(operationTimer.current), []);
  useEffect(() => {
    if (demo)
      demoRef.current?.querySelector<HTMLElement>("#demo-title")?.focus();
  }, [stage, redeemed, demo]);
  function openDemo() {
    clearTimeout(operationTimer.current);
    focusBefore.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setStage(0);
    setRedeemed(false);
    setBusy(false);
    setDemo(true);
    setMenu(false);
  }
  function deposit() {
    setBusy(true);
    operationTimer.current = setTimeout(() => {
      setBusy(false);
      setStage(2);
    }, 1400);
  }
  function redeem() {
    setBusy(true);
    operationTimer.current = setTimeout(() => {
      setBusy(false);
      setRedeemed(true);
    }, 1000);
  }
  return (
    <div className="reloop-landing" data-motion={motion ? "on" : "off"}>
      <div className="poster-frame" inert={demo}>
        <div className="reading-progress" />
        <a className="skip-link" href="#cara-kerja">
          Langsung ke cara kerja
        </a>
        <header className="site-header">
          <a href="#" aria-label="ReLoop, kembali ke awal">
            <img
              className="brand-logo"
              src={assets + "logo.svg"}
              alt="ReLoop"
            />
          </a>
          <nav
            aria-label="Navigasi utama"
            className={menu ? "nav open" : "nav"}
          >
            <a href="#cara-kerja" onClick={() => setMenu(false)}>
              Cara kerja
            </a>
            <a href="#ekosistem" onClick={() => setMenu(false)}>
              Ekosistem
            </a>
            <span className="nav-divider" />
            <Link href="/login">
              Masuk <ArrowUpRight size={13} />
            </Link>
            <Link className="button dark small" href="/register">
              Mulai setor <ArrowRight />
            </Link>
          </nav>
          <button
            className="menu-button"
            aria-label={menu ? "Tutup menu" : "Buka menu"}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <List />}
          </button>
        </header>
        <main>
          <section className="hero" ref={hero} aria-labelledby="hero-title">
            <div className="hero-type">
              <h1 id="hero-title">
                <img src={assets + "heading-v2.webp"} alt="Selesai dipakai." />
              </h1>
              <div className="slogan">
                <img
                  src={assets + "slogan-v2.webp"}
                  alt="Belum selesai berarti."
                />
              </div>
            </div>
            <div className="hero-art" aria-hidden="true">
              <img
                className="hero-ground"
                src={assets + "ground-v3.webp"}
                alt=""
              />
              <BottleCoil motion={motion && !demo} />
              <img className="hero-can" src={assets + "can.webp"} alt="" />
            </div>
            <div className="hero-receipt">
              <img
                src={assets + "receipt-v2.webp"}
                alt="Struk simulasi: setoran 1 botol plastik PET tercatat, 15 poin masuk."
              />
            </div>
            <div className="hero-intro">
              <p>
                Setor sampah di mesin ReLoop.
                <br />
                Kumpulkan poin dan cairkan reward.
              </p>
              <Link className="button dark" href="/register">
                Mulai perjalananmu <ArrowRight />
              </Link>
            </div>
            <a href="#cara-kerja" className="scroll-hint">
              <span>TERUSKAN PUTARANNYA</span>
              <ArrowDown size={19} />
            </a>
          </section>
          <div className="ticker" aria-hidden="true">
            <div className="ticker-track">
              {Array.from({ length: 10 }, (_, i) => (
                <span key={i}>
                  <img src={assets + "mark.svg"} alt="" />
                  SETOR. PUTAR. ULANG.
                </span>
              ))}
            </div>
          </div>
          <section className="how-section" id="cara-kerja">
            <div className="how-content">
              <div className="section-intro" data-reveal>
                <h2>
                  Dari tanganmu,
                  <br />
                  kembali bernilai.
                </h2>
                <p>
                  Sampah yang kamu setor diproses dan dikumpulkan kembali oleh
                  pengelola, lalu menjadi bahan baku daur ulang. Setiap setoran
                  tercatat di satu sistem yang sama.
                </p>
              </div>
              <div
                className="step-list"
                role="tablist"
                aria-label="Tiga langkah ReLoop"
              >
                {steps.map((s, i) => (
                  <button
                    key={s.title}
                    role="tab"
                    id={`step-${i}`}
                    aria-selected={activeStep === i}
                    aria-controls="step-detail"
                    tabIndex={activeStep === i ? 0 : -1}
                    onClick={() => setActiveStep(i)}
                    onKeyDown={(e) => {
                      if (
                        ["ArrowRight", "ArrowLeft", "Home", "End"].includes(
                          e.key,
                        )
                      ) {
                        e.preventDefault();
                        const next =
                          e.key === "Home"
                            ? 0
                            : e.key === "End"
                              ? 2
                              : (i + (e.key === "ArrowRight" ? 1 : 2)) % 3;
                        setActiveStep(next);
                        document.getElementById(`step-${next}`)?.focus();
                      }
                    }}
                    className={`step ${activeStep === i ? "active" : ""}`}
                  >
                    <div className="step-top">
                      <span className="step-number">0{i + 1}</span>
                      <span className="step-icon">
                        <s.icon size={25} />
                      </span>
                    </div>
                    <div className="step-rail">
                      <span />
                      <ArrowRight size={21} />
                    </div>
                    <h3>{s.title}</h3>
                    <p>{s.description}</p>
                  </button>
                ))}
              </div>
              <div
                className="step-detail"
                id="step-detail"
                role="tabpanel"
                aria-labelledby={`step-${activeStep}`}
              >
                <span className="step-current">0{activeStep + 1} / 03</span>
                <span>
                  {
                    [
                      "Satu scan untuk memulai.",
                      "Mesin mencatat, kamu cukup menyetor.",
                      "Kebiasaan baikmu kembali bernilai.",
                    ][activeStep]
                  }
                </span>
              </div>
              <button className="text-button demo-entry" onClick={openDemo}>
                <Play size={17} weight="fill" />
                Coba simulasi setoran <ArrowUpRight size={19} />
              </button>
            </div>
            <div className={`machine-art machine-step-${activeStep}`}>
              <img
                src={assets + "machine-phone-v2.webp"}
                alt="Visualisasi konsep mesin ReLoop dan layar aplikasi setelah setoran"
                loading="lazy"
              />
              <span>Visualisasi konsep mesin · Tampilan simulasi</span>
            </div>
          </section>
          <section className="ecosystem" id="ekosistem">
            <div className="ecosystem-grid">
              <h2 data-reveal>
                Satu gerakan.
                <br />
                Banyak peran.
              </h2>
              {roles.map((r, i) => (
                <button
                  key={r.name}
                  className={`role ${role === i ? "selected" : ""}`}
                  onClick={() => setRole(i)}
                  aria-pressed={role === i}
                >
                  <img src={assets + r.image} alt="" loading="lazy" />
                  <h3>
                    {r.name}
                    <ArrowUpRight size={21} />
                  </h3>
                  <p>{r.text}</p>
                </button>
              ))}
            </div>
            <div className="role-note" aria-live="polite">
              <span>PUTARAN TERUS BERJALAN</span>
              <p>
                {
                  [
                    "Berawal dari kamu. Setorkan sampahmu, pantau riwayatnya, dan pilih reward di akun ReLoop.",
                    "Setiap lokasi punya peran. Pengelola menjaga alur setoran dan menyiapkan sampah untuk penjemputan.",
                    "Sampah terpilah punya tujuan. Pengepul menghubungkan lokasi pengumpulan dengan rantai daur ulang.",
                  ][role]
                }
              </p>
              <Recycle size={50} weight="bold" />
            </div>
          </section>
        </main>
        <footer>
          <a href="#">
            <img
              className="brand-logo"
              src={assets + "logo.svg"}
              alt="ReLoop"
            />
          </a>
          <span>Sampah selesai. Dampak dimulai.</span>
          <div>
            <Link href="/privacy">
              Privasi <ArrowUpRight size={12} />
            </Link>
            <Link href="/terms">
              Ketentuan <ArrowUpRight size={12} />
            </Link>
            <span>© {new Date().getFullYear()} ReLoop</span>
          </div>
        </footer>
      </div>
      <button
        className="motion-toggle"
        inert={demo}
        onClick={() => setMotion(!userMotion)}
        aria-label={motion ? "Jeda animasi" : "Putar animasi"}
        title={motion ? "Jeda animasi" : "Putar animasi"}
      >
        {motion ? <Pause weight="fill" /> : <Play weight="fill" />}
        <span>{motion ? "Jeda motion" : "Putar motion"}</span>
      </button>
      {demo && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDemo();
          }}
        >
          <section
            className="demo-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="demo-title"
            ref={demoRef}
            tabIndex={-1}
          >
            <div className="demo-header">
              <img src={assets + "logo.svg"} alt="ReLoop" />
              <span>SIMULASI INTERAKTIF</span>
              <button
                className="icon-button"
                onClick={closeDemo}
                aria-label="Tutup simulasi"
              >
                <X size={24} />
              </button>
            </div>
            <div className="demo-progress">
              {["Pindai", "Setor", "Reward"].map((s, i) => (
                <span className={stage >= i ? "done" : ""} key={s}>
                  <b>{i + 1}</b>
                  {s}
                </span>
              ))}
            </div>
            <div className="demo-body" key={stage + (redeemed ? "r" : "")}>
              {stage === 0 && (
                <>
                  <div className="scan-graphic">
                    <QrCode size={128} weight="regular" />
                    <div className="scan-beam" />
                  </div>
                  <h2 id="demo-title" tabIndex={-1}>
                    Satu scan.
                    <br />
                    Satu awal yang baik.
                  </h2>
                  <p>
                    Bayangkan kamu berada di depan mesin ReLoop. Pindai kode QR
                    di layar mesin untuk memulai setoran.
                  </p>
                  <button
                    className="button dark full"
                    onClick={() => setStage(1)}
                  >
                    <Scan size={22} />
                    Simulasikan scan QR <ArrowRight />
                  </button>
                </>
              )}
              {stage === 1 && (
                <>
                  <h2 id="demo-title" tabIndex={-1}>
                    Botolmu siap
                    <br />
                    berputar lagi.
                  </h2>
                  <div className={`deposit-visual ${busy ? "depositing" : ""}`}>
                    <img
                      src={assets + "bottle.webp"}
                      alt="Botol plastik yang akan disetorkan"
                    />
                    <Recycle size={76} weight="light" />
                  </div>
                  <div className="quantity">
                    <span>Botol plastik PET</span>
                    <div>
                      <button
                        aria-label="Kurangi jumlah botol"
                        onClick={() => setCount(Math.max(1, count - 1))}
                        disabled={count === 1 || busy}
                      >
                        <Minus />
                      </button>
                      <output aria-label="Jumlah botol">{count}</output>
                      <button
                        aria-label="Tambah jumlah botol"
                        onClick={() => setCount(Math.min(10, count + 1))}
                        disabled={count === 10 || busy}
                      >
                        <Plus />
                      </button>
                    </div>
                  </div>
                  <p className="demo-disclaimer">
                    Contoh simulasi: 15 poin per botol. Nilai setoran sebenarnya
                    mengikuti ketentuan ReLoop.
                  </p>
                  <button
                    className="button dark full"
                    onClick={deposit}
                    disabled={busy}
                  >
                    {busy
                      ? "Mesin sedang mencatat…"
                      : "Setorkan " + count + " botol"}
                    {busy ? <Recycle className="spin" /> : <ArrowRight />}
                  </button>
                  <p role="status" className="sr-only">
                    {busy ? "Setoran sedang diproses." : ""}
                  </p>
                </>
              )}
              {stage === 2 && !redeemed && (
                <>
                  <div className="success-mark">
                    <Check size={32} weight="bold" />
                  </div>
                  <h2 id="demo-title" tabIndex={-1}>
                    Setoran selesai.
                    <br />
                    Nilainya kembali.
                  </h2>
                  <Receipt count={count} success compact />
                  <label className="redeem-label" htmlFor="method">
                    Coba pencairan ke
                  </label>
                  <select
                    id="method"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                  >
                    <option>DANA</option>
                    <option>GoPay</option>
                    <option>OVO</option>
                    <option>ShopeePay</option>
                    <option>Rekening bank</option>
                  </select>
                  <button
                    className="button dark full"
                    onClick={redeem}
                    disabled={busy}
                  >
                    {busy ? "Memproses simulasi…" : "Simulasikan pencairan"}
                    <ArrowRight />
                  </button>
                </>
              )}
              {redeemed && (
                <>
                  <div className="success-mark">
                    <Check size={32} weight="bold" />
                  </div>
                  <h2 id="demo-title" tabIndex={-1}>
                    Kebiasaan kecil.
                    <br />
                    Putaran berarti.
                  </h2>
                  <p className="redeemed-text">
                    Simulasi pencairan {count * 15} poin ke <b>{method}</b>{" "}
                    selesai. Tidak ada saldo atau transaksi sungguhan pada demo
                    ini.
                  </p>
                  <Link className="button dark full" href="/register">
                    Buat akun ReLoop <ArrowUpRight />
                  </Link>
                  <button
                    className="text-button reset-demo"
                    onClick={() => {
                      setStage(0);
                      setRedeemed(false);
                    }}
                  >
                    <ArrowCounterClockwise />
                    Coba sekali lagi
                  </button>
                </>
              )}
            </div>
            <p className="demo-bottom">
              Simulasi · Tidak memakai kamera atau data akun.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
