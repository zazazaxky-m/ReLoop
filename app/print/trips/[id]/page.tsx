import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { PrintControls } from "@/components/trip/PrintControls";

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
      bagAssignments: {
        orderBy: { assignedAt: "asc" },
        include: { wasteType: { select: { name: true } } },
      },
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
        wasteTypeName: bag.wasteType?.name ?? "Campuran",
        qrDataUrl,
      };
    }),
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
        <PrintControls />
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
                <span className="mt-1 rounded-full border border-gray-300 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-700">
                  {bag.wasteTypeName}
                </span>
                <span className="mt-0.5 text-[9px] text-gray-500">ReLoop Smart Waste Bank</span>
              </div>
            ))}
          </div>
        )}
      </div>

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
