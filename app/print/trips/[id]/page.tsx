import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { PrintControls } from "@/components/trip/PrintControls";

export const metadata: Metadata = { title: "Cetak QR Trash Bag" };

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ layout?: string }>;
}

type PrintLayout = "sticker" | "sheet";

export default async function PrintTripQrsPage({ params, searchParams }: PageProps) {
  const user = await requirePageUser(["ADMIN", "SUPERADMIN"]);
  const { id } = await params;
  const { layout: layoutParam } = await searchParams;
  const layout: PrintLayout = layoutParam === "sheet" ? "sheet" : "sticker";

  const trip = await prisma.trip.findUnique({
    where: { id },
    include: {
      campaign: { select: { name: true, organizationId: true } },
      travelAgent: { select: { name: true } },
      bagAssignments: {
        orderBy: { assignedAt: "asc" },
        include: { wasteType: { select: { name: true } } },
      },
    },
  });

  if (!trip) notFound();

  if (user.role === "ADMIN" && trip.campaign.organizationId !== user.organizationId) {
    notFound();
  }

  const printedAt = new Date().toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const groupLabel = trip.groupName ?? "Rombongan";
  const agentLabel = trip.travelAgent?.name ?? trip.travelAgentName ?? null;

  const bagsWithQr = await Promise.all(
    trip.bagAssignments.map(async (bag, index) => {
      const qrDataUrl = await QRCode.toDataURL(bag.bagQrCode, {
        width: 512,
        margin: 1,
        errorCorrectionLevel: "H",
        color: { dark: "#052e1c", light: "#ffffff" },
      });
      return {
        id: bag.id,
        code: bag.bagQrCode,
        shortCode: bag.bagQrCode.replace(/^BAG-/, ""),
        wasteTypeName: bag.wasteType?.name ?? "Campuran",
        index: index + 1,
        qrDataUrl,
      };
    }),
  );

  return (
    <div className="print-root min-h-screen bg-slate-100 text-slate-900">
      {/* Screen-only control panel */}
      <div className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              ReLoop Print Studio
            </p>
            <h1 className="text-xl font-bold text-slate-900">Cetak Stiker QR Trash Bag</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {groupLabel} · {trip.campaign.name} · {bagsWithQr.length} kantong
            </p>
          </div>
          <PrintControls tripId={id} layout={layout} />
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {trip.status === "CANCELLED" ? (
          <div className="no-print mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Trip ini berstatus <strong>CANCELLED</strong>. QR masih bisa dicetak untuk
            dokumentasi, tetapi jangan diterbitkan ulang ke rombongan aktif.
          </div>
        ) : null}

        {/* Screen preview header */}
        <div className="no-print mb-6 rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Pratinjau stiker</h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
                Layout <strong>Stiker</strong> cocok untuk label 50×70 mm (2 kolom × 4 baris per
                halaman A4). Layout <strong>Lembar</strong> menampilkan kartu lebih besar untuk
                dokumentasi atau laminasi.
              </p>
            </div>
            <div className="rounded-xl bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-slate-200">
              <p className="font-semibold text-slate-800">Tips cetak</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-500">
                <li>Gunakan kertas stiker A4 matte</li>
                <li>Skala cetak: 100% (tanpa fit-to-page)</li>
                <li>Margin printer: minimum / none</li>
              </ul>
            </div>
          </div>
        </div>

        {bagsWithQr.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-500">
            Belum ada kantong sampah yang terbit untuk trip ini.
          </div>
        ) : layout === "sticker" ? (
          <div className="sticker-sheet">
            {chunk(bagsWithQr, 8).map((pageBags, pageIndex) => (
              <section
                key={`page-${pageIndex}`}
                className="sticker-page"
                aria-label={`Halaman stiker ${pageIndex + 1}`}
              >
                <header className="sticker-page-header">
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="/reloop-logo.svg"
                      alt="ReLoop"
                      className="h-8 w-8 object-contain"
                    />
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-800">
                        ReLoop Trash Bag
                      </p>
                      <p className="text-[11px] text-slate-600">
                        {groupLabel}
                        {agentLabel ? ` · ${agentLabel}` : ""} · {trip.campaign.name}
                      </p>
                    </div>
                  </div>
                  <div className="text-right text-[10px] text-slate-500">
                    <p>
                      Hal. {pageIndex + 1}/{Math.ceil(bagsWithQr.length / 8)}
                    </p>
                    <p>{printedAt}</p>
                  </div>
                </header>

                <div className="sticker-grid">
                  {pageBags.map((bag) => (
                    <article key={bag.id} className="sticker-label">
                      <div className="sticker-label-top">
                        <span className="sticker-brand">ReLoop</span>
                        <span className="sticker-index">
                          #{String(bag.index).padStart(2, "0")}
                        </span>
                      </div>
                      <div className="sticker-qr-wrap">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={bag.qrDataUrl} alt={bag.code} className="sticker-qr" />
                      </div>
                      <p className="sticker-code">{bag.code}</p>
                      <div className="sticker-meta">
                        <span className="sticker-waste">{bag.wasteTypeName}</span>
                        <span className="sticker-group" title={groupLabel}>
                          {truncate(groupLabel, 18)}
                        </span>
                      </div>
                      <p className="sticker-footer">Scan di gerbang · Jangan sobek</p>
                      <div className="sticker-cut-marks" aria-hidden />
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="sheet-grid">
            {bagsWithQr.map((bag) => (
              <article key={bag.id} className="sheet-card">
                <div className="sheet-card-brand">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/reloop-logo.svg" alt="" className="h-7 w-7 object-contain" />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">
                      ReLoop
                    </p>
                    <p className="text-[11px] text-slate-500">Smart Waste · Trash Bag</p>
                  </div>
                  <span className="ml-auto rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-800">
                    #{String(bag.index).padStart(2, "0")}
                  </span>
                </div>
                <div className="sheet-qr-wrap">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={bag.qrDataUrl} alt={bag.code} className="sheet-qr" />
                </div>
                <p className="sheet-code">{bag.code}</p>
                <div className="sheet-details">
                  <div>
                    <p className="label">Jenis</p>
                    <p className="value">{bag.wasteTypeName}</p>
                  </div>
                  <div>
                    <p className="label">Trip</p>
                    <p className="value">{groupLabel}</p>
                  </div>
                  <div>
                    <p className="label">Campaign</p>
                    <p className="value">{trip.campaign.name}</p>
                  </div>
                </div>
                <p className="sheet-hint">Tempel di kantong · Scan saat check-in / check-out</p>
              </article>
            ))}
          </div>
        )}
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
          :root {
            --reloop-ink: #052e1c;
            --reloop-brand: #0ca160;
            --reloop-soft: #ecfdf5;
          }

          .print-root {
            font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          /* ===== Sticker layout (A4, 2×4) ===== */
          .sticker-page {
            background: white;
            border-radius: 16px;
            box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
            padding: 18mm 14mm 14mm;
            margin-bottom: 24px;
          }

          .sticker-page-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 10mm;
            padding-bottom: 4mm;
            border-bottom: 1.5px solid #d1fae5;
          }

          .sticker-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8mm 10mm;
          }

          .sticker-label {
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 70mm;
            padding: 5mm 4mm 4mm;
            border: 1.5px dashed #94a3b8;
            border-radius: 4mm;
            background:
              linear-gradient(180deg, #f0fdf4 0%, #ffffff 28%, #ffffff 100%);
          }

          .sticker-label-top {
            width: 100%;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2mm;
          }

          .sticker-brand {
            font-size: 9px;
            font-weight: 800;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            color: var(--reloop-brand);
          }

          .sticker-index {
            font-size: 10px;
            font-weight: 700;
            color: #64748b;
            font-variant-numeric: tabular-nums;
          }

          .sticker-qr-wrap {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2mm;
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 3mm;
            box-shadow: inset 0 0 0 3px white;
          }

          .sticker-qr {
            width: 38mm;
            height: 38mm;
            object-fit: contain;
          }

          .sticker-code {
            margin-top: 3mm;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.04em;
            color: var(--reloop-ink);
          }

          .sticker-meta {
            margin-top: 2mm;
            width: 100%;
            display: flex;
            justify-content: space-between;
            gap: 2mm;
            font-size: 9px;
            color: #475569;
          }

          .sticker-waste {
            font-weight: 700;
            color: #065f46;
            background: var(--reloop-soft);
            border: 1px solid #a7f3d0;
            border-radius: 999px;
            padding: 1mm 2.5mm;
            max-width: 55%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .sticker-group {
            max-width: 42%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            text-align: right;
            align-self: center;
          }

          .sticker-footer {
            margin-top: auto;
            padding-top: 2mm;
            font-size: 8px;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            color: #94a3b8;
          }

          .sticker-cut-marks {
            pointer-events: none;
            position: absolute;
            inset: -1.5mm;
            border: 0.4px solid transparent;
          }

          /* ===== Sheet / card layout ===== */
          .sheet-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 18px;
          }

          .sheet-card {
            break-inside: avoid;
            page-break-inside: avoid;
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 18px;
            padding: 18px;
            box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
            display: flex;
            flex-direction: column;
            align-items: center;
          }

          .sheet-card-brand {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 14px;
          }

          .sheet-qr-wrap {
            padding: 12px;
            border-radius: 16px;
            background: linear-gradient(180deg, #ecfdf5, #ffffff);
            border: 1px solid #d1fae5;
          }

          .sheet-qr {
            width: 180px;
            height: 180px;
            object-fit: contain;
          }

          .sheet-code {
            margin-top: 14px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            font-size: 15px;
            font-weight: 800;
            letter-spacing: 0.06em;
            color: var(--reloop-ink);
          }

          .sheet-details {
            margin-top: 14px;
            width: 100%;
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            text-align: center;
          }

          .sheet-details .label {
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #94a3b8;
            font-weight: 700;
          }

          .sheet-details .value {
            margin-top: 2px;
            font-size: 11px;
            font-weight: 600;
            color: #334155;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .sheet-hint {
            margin-top: 14px;
            font-size: 10px;
            color: #64748b;
            text-align: center;
          }

          @media (max-width: 720px) {
            .sheet-grid {
              grid-template-columns: 1fr;
            }
          }

          @page {
            size: A4;
            margin: 8mm;
          }

          @media print {
            .no-print {
              display: none !important;
            }

            html, body {
              background: white !important;
              margin: 0 !important;
              padding: 0 !important;
            }

            .print-root {
              background: white !important;
              min-height: auto !important;
            }

            .print-root > .mx-auto {
              max-width: none !important;
              padding: 0 !important;
              margin: 0 !important;
            }

            .sticker-page {
              box-shadow: none !important;
              border-radius: 0 !important;
              margin: 0 !important;
              padding: 0 !important;
              width: 100%;
              min-height: auto;
              page-break-after: always;
              break-after: page;
            }

            .sticker-page:last-child {
              page-break-after: auto;
              break-after: auto;
            }

            .sticker-page-header {
              margin-bottom: 6mm;
            }

            .sticker-grid {
              gap: 6mm 8mm;
            }

            .sticker-label {
              min-height: 62mm;
              background: white !important;
            }

            .sheet-grid {
              grid-template-columns: repeat(2, 1fr);
              gap: 10mm;
            }

            .sheet-card {
              box-shadow: none !important;
              border: 1.5px solid #cbd5e1 !important;
            }
          }
        `,
        }}
      />
    </div>
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
