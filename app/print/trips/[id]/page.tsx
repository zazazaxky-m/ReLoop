import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Cetak QR Trash Bag" };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PrintTripQrsPage({ params }: PageProps) {
  const user = await requirePageUser(["ADMIN", "SUPERADMIN"]);
  const { id } = await params;

  const trip = await prisma.trip.findUnique({
    where: { id },
    include: {
      campaign: { select: { name: true, organizationId: true } },
      bagAssignments: { orderBy: { assignedAt: "asc" } },
    },
  });

  if (!trip) notFound();

  // Security check: Admins can only print their own organization's trips
  if (user.role === "ADMIN" && trip.campaign.organizationId !== user.organizationId) {
    notFound();
  }

  // Pre-generate QR Code data URLs on the server
  const bagsWithQr = await Promise.all(
    trip.bagAssignments.map(async (bag) => {
      const qrDataUrl = await QRCode.toDataURL(bag.bagQrCode, {
        width: 180,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
      });
      return {
        id: bag.id,
        code: bag.bagQrCode,
        qrDataUrl,
      };
    })
  );

  return (
    <div className="min-h-screen bg-white p-8 text-black font-sans">
      {/* Control Panel (Hidden on Print) */}
      <div className="no-print mb-8 flex items-center justify-between border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Siap Cetak QR Trash Bag</h1>
          <p className="text-sm text-gray-500">
            {trip.groupName ?? "Rombongan"} &middot; {trip.campaign.name}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => window.close()}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Tutup Tab
          </button>
          <button
            onClick={() => window.print()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Cetak Sekarang
          </button>
        </div>
      </div>

      {/* Printable Area */}
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 border-b-2 border-black pb-4 text-center">
          <h2 className="text-2xl font-bold uppercase tracking-wider">ReLoop Trash Bag QR</h2>
          <p className="mt-1 text-sm text-gray-600">
            Trip: <strong>{trip.groupName ?? "Rombongan"}</strong> | Campaign: <strong>{trip.campaign.name}</strong>
          </p>
          <p className="text-xs text-gray-500">
            Total: {bagsWithQr.length} Kantong &middot; Tanggal Cetak: {new Date().toLocaleDateString("id-ID")}
          </p>
        </div>

        {/* QR Code Grid */}
        {bagsWithQr.length === 0 ? (
          <div className="py-12 text-center text-gray-500">
            Belum ada kantong sampah yang terbit untuk trip ini.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-6 sm:grid-cols-4 md:grid-cols-4">
            {bagsWithQr.map((bag) => (
              <div
                key={bag.id}
                className="qr-card flex flex-col items-center justify-center rounded-lg border border-gray-300 p-4 text-center"
                style={{ pageBreakInside: "avoid", breakInside: "avoid" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={bag.qrDataUrl} alt={bag.code} className="h-32 w-32 object-contain" />
                <span className="mt-2 font-mono text-xs font-bold uppercase tracking-wider text-gray-900">
                  {bag.code}
                </span>
                <span className="mt-0.5 text-[9px] text-gray-500">ReLoop Smart Waste Bank</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Auto-print trigger scripts */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            // Auto trigger print when loaded
            window.addEventListener('load', function() {
              setTimeout(function() {
                window.print();
              }, 500);
            });
          `,
        }}
      />

      <style dangerouslySetInnerHTML={{
        __html: `
          @media print {
            .no-print {
              display: none !important;
            }
            body {
              padding: 0 !important;
              margin: 0 !important;
              background: white !important;
            }
          }
        `
      }} />
    </div>
  );
}
