import { formatDateTime } from "@/lib/format";
import type { MachineCaptureRow } from "@/lib/machine-captures";

const kindLabels: Record<string, string> = {
  SESSION_START: "Awal sesi",
  FRAUD: "Fraud",
  SECURITY: "Keamanan",
};

export function MachineCaptureGallery({
  captures,
}: {
  captures: MachineCaptureRow[];
}) {
  if (!captures.length) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center">
        <p className="font-medium text-foreground">Belum ada capture kamera</p>
        <p className="mt-1 text-sm text-muted">
          Gambar muncul saat sesi dimulai atau mesin mendeteksi fraud/vandalisme.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {captures.map((capture) => (
        <article
          key={capture.id}
          className="overflow-hidden rounded-xl border border-border bg-slate-50"
        >
          <a
            href={`/api/machine-captures/${capture.id}/image/scene`}
            target="_blank"
            rel="noreferrer"
            className="block bg-slate-900"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/machine-captures/${capture.id}/image/scene`}
              alt={`Capture ${capture.reason}`}
              className="aspect-video w-full object-cover"
              loading="lazy"
            />
          </a>
          <div className="space-y-3 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-foreground">
                  {kindLabels[capture.kind] ?? capture.kind}
                </p>
                <p className="text-xs text-muted">{capture.reason}</p>
              </div>
              <span className="whitespace-nowrap text-xs text-muted">
                {formatDateTime(capture.occurredAt)}
              </span>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-white px-2 py-1 text-slate-600">
                {capture.personDetected
                  ? "Orang terdeteksi"
                  : "Orang tidak terdeteksi"}
              </span>
              <span className="rounded-full bg-white px-2 py-1 text-slate-600">
                {capture.faceCount} wajah
              </span>
            </div>

            {capture.faceCount > 0 ? (
              <div>
                <p className="mb-2 text-xs font-medium text-muted">
                  Crop wajah
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {Array.from({ length: capture.faceCount }, (_, index) => (
                    <a
                      key={index}
                      href={`/api/machine-captures/${capture.id}/image/face-${index + 1}`}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/machine-captures/${capture.id}/image/face-${index + 1}`}
                        alt={`Crop wajah ${index + 1}`}
                        className="h-20 w-20 rounded-lg border border-border object-cover"
                        loading="lazy"
                      />
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
