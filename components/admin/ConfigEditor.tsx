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
} from "@/components/ui";
import { Plus, Trash } from "@/components/ui/icons";
import type { HeroSlide } from "@/lib/hero-slides";

type SlideKind = "landing" | "mobile";

export function ConfigEditor({
  initial,
}: {
  initial: {
    minRedemption: number;
    qrRotation: number;
    pointsToRupiah: number;
    landingSlides: HeroSlide[];
    mobileSlides: HeroSlide[];
  };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [form, setForm] = useState({
    min_redemption: String(initial.minRedemption),
    default_qr_rotation_seconds: String(initial.qrRotation),
    points_to_rupiah: String(initial.pointsToRupiah),
  });
  const [landingSlides, setLandingSlides] = useState(initial.landingSlides);
  const [mobileSlides, setMobileSlides] = useState(initial.mobileSlides);

  function slidesFor(kind: SlideKind) {
    return kind === "landing" ? landingSlides : mobileSlides;
  }

  function setSlides(kind: SlideKind, slides: HeroSlide[]) {
    if (kind === "landing") setLandingSlides(slides);
    else setMobileSlides(slides);
  }

  function updateSlide(
    kind: SlideKind,
    index: number,
    key: keyof HeroSlide,
    value: string,
  ) {
    setSlides(
      kind,
      slidesFor(kind).map((slide, slideIndex) =>
        slideIndex === index ? { ...slide, [key]: value } : slide,
      ),
    );
  }

  function addSlide(kind: SlideKind) {
    setSlides(kind, [
      ...slidesFor(kind),
      {
        eyebrow: kind === "mobile" ? "Program ReLoop" : "Konten baru",
        title: "Judul slide baru",
        description: "Deskripsi singkat slide.",
        imageUrl: "",
        href: kind === "mobile" ? "/campaigns" : "/register",
      },
    ]);
  }

  async function uploadImage(
    kind: SlideKind,
    index: number,
    file?: File,
  ) {
    if (!file) return;
    const uploadKey = `${kind}-${index}`;
    setUploading(uploadKey);
    setError(null);
    setMsg(null);
    try {
      const body = new FormData();
      body.append("image", file);
      const res = await fetch("/api/uploads/hero", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Gagal mengunggah gambar");
        return;
      }
      updateSlide(kind, index, "imageUrl", data.url);
      setMsg(`Gambar ${kind === "mobile" ? "mobile" : "landing"} berhasil diunggah.`);
    } catch {
      setError("Tidak dapat mengunggah gambar");
    } finally {
      setUploading(null);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          min_redemption: Number(form.min_redemption),
          default_qr_rotation_seconds: Number(
            form.default_qr_rotation_seconds,
          ),
          points_to_rupiah: Number(form.points_to_rupiah),
          landing_hero_slides: JSON.stringify(landingSlides),
          mobile_hero_slides: JSON.stringify(mobileSlides),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Gagal menyimpan konfigurasi");
        return;
      }
      setMsg("Konfigurasi tersimpan.");
      router.refresh();
    } catch {
      setError("Tidak dapat menyimpan konfigurasi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Editor Konfigurasi</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error">
              {error}
            </div>
          ) : null}
          {msg ? (
            <div className="rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm text-brand-700">
              {msg}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Minimum redemption (Rp)" htmlFor="cfg-min">
              <Input
                id="cfg-min"
                type="number"
                value={form.min_redemption}
                onChange={(e) =>
                  setForm((value) => ({
                    ...value,
                    min_redemption: e.target.value,
                  }))
                }
              />
            </FormField>
            <FormField label="Rotasi QR default (detik)" htmlFor="cfg-qr">
              <Input
                id="cfg-qr"
                type="number"
                value={form.default_qr_rotation_seconds}
                onChange={(e) =>
                  setForm((value) => ({
                    ...value,
                    default_qr_rotation_seconds: e.target.value,
                  }))
                }
              />
            </FormField>
            <FormField label="1 poin = Rp" htmlFor="cfg-pts">
              <Input
                id="cfg-pts"
                type="number"
                value={form.points_to_rupiah}
                onChange={(e) =>
                  setForm((value) => ({
                    ...value,
                    points_to_rupiah: e.target.value,
                  }))
                }
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <SlideEditor
        kind="landing"
        title="Carousel Landing Page"
        description="Khusus halaman landing web. Rasio gambar yang disarankan 16:7."
        slides={landingSlides}
        uploading={uploading}
        onAdd={() => addSlide("landing")}
        onRemove={(index) =>
          setLandingSlides((slides) =>
            slides.filter((_, slideIndex) => slideIndex !== index),
          )
        }
        onUpdate={(index, key, value) =>
          updateSlide("landing", index, key, value)
        }
        onUpload={(index, file) => uploadImage("landing", index, file)}
      />

      <SlideEditor
        kind="mobile"
        title="Slider Iklan Mobile"
        description="Khusus Dashboard aplikasi. Gunakan banner lebar rasio sekitar 12:5 agar tampil lebih tinggi dan tetap proporsional."
        slides={mobileSlides}
        uploading={uploading}
        onAdd={() => addSlide("mobile")}
        onRemove={(index) =>
          setMobileSlides((slides) =>
            slides.filter((_, slideIndex) => slideIndex !== index),
          )
        }
        onUpdate={(index, key, value) =>
          updateSlide("mobile", index, key, value)
        }
        onUpload={(index, file) => uploadImage("mobile", index, file)}
      />

      <Button type="submit" size="lg" disabled={busy}>
        {busy ? "Menyimpan..." : "Simpan Semua Konfigurasi"}
      </Button>
    </form>
  );
}

function SlideEditor({
  kind,
  title,
  description,
  slides,
  uploading,
  onAdd,
  onRemove,
  onUpdate,
  onUpload,
}: {
  kind: SlideKind;
  title: string;
  description: string;
  slides: HeroSlide[];
  uploading: string | null;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, key: keyof HeroSlide, value: string) => void;
  onUpload: (index: number, file?: File) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{title}</CardTitle>
            <p className="mt-1 text-sm text-muted">{description}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={onAdd}
            disabled={slides.length >= 6}
          >
            <Plus /> Tambah Slide
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {slides.map((slide, index) => {
          const uploadKey = `${kind}-${index}`;
          return (
            <div
              key={index}
              className="rounded-2xl border border-border bg-slate-50/60 p-4"
            >
              <div className="mb-4 flex items-center justify-between">
                <p className="font-semibold text-foreground">Slide {index + 1}</p>
                {slides.length > 1 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onRemove(index)}
                  >
                    <Trash /> Hapus
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <div
                    className={`relative overflow-hidden rounded-xl border border-border bg-emerald-950 bg-cover bg-center ${
                      kind === "mobile" ? "aspect-[12/5]" : "aspect-[16/7]"
                    }`}
                    style={
                      slide.imageUrl
                        ? {
                            backgroundImage: `url("${slide.imageUrl.replaceAll('"', "%22")}")`,
                          }
                        : undefined
                    }
                  >
                    {!slide.imageUrl ? (
                      <div className="flex h-full items-center justify-center text-sm font-medium text-white/60">
                        Belum ada gambar
                      </div>
                    ) : null}
                    <label className="absolute bottom-3 right-3 inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-white px-3 text-sm font-semibold text-emerald-950 shadow-md hover:bg-emerald-50">
                      {uploading === uploadKey
                        ? "Mengunggah..."
                        : "Upload gambar"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        disabled={uploading !== null}
                        onChange={(event) => {
                          void onUpload(index, event.target.files?.[0]);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </div>
                <FormField label="Label kecil">
                  <Input
                    value={slide.eyebrow}
                    onChange={(event) =>
                      onUpdate(index, "eyebrow", event.target.value)
                    }
                    maxLength={60}
                  />
                </FormField>
                <FormField label="Tautan tujuan">
                  <Input
                    value={slide.href}
                    onChange={(event) =>
                      onUpdate(index, "href", event.target.value)
                    }
                    placeholder={kind === "mobile" ? "/campaigns" : "/register"}
                  />
                </FormField>
                <FormField label="Judul" className="sm:col-span-2" required>
                  <Input
                    value={slide.title}
                    onChange={(event) =>
                      onUpdate(index, "title", event.target.value)
                    }
                    maxLength={140}
                    required
                  />
                </FormField>
                <FormField label="Deskripsi" className="sm:col-span-2">
                  <Input
                    value={slide.description}
                    onChange={(event) =>
                      onUpdate(index, "description", event.target.value)
                    }
                    maxLength={180}
                  />
                </FormField>
                <FormField
                  label="URL / path gambar"
                  hint="Terisi otomatis setelah upload. URL HTTPS juga dapat digunakan."
                  className="sm:col-span-2"
                >
                  <Input
                    value={slide.imageUrl}
                    onChange={(event) =>
                      onUpdate(index, "imageUrl", event.target.value)
                    }
                    placeholder="https://... atau /uploads/hero/banner.jpg"
                  />
                </FormField>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
