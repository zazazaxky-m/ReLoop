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

export function ConfigEditor({
  initial,
}: {
  initial: {
    minRedemption: number;
    qrRotation: number;
    pointsToRupiah: number;
    heroSlides: HeroSlide[];
  };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    min_redemption: String(initial.minRedemption),
    default_qr_rotation_seconds: String(initial.qrRotation),
    points_to_rupiah: String(initial.pointsToRupiah),
  });
  const [heroSlides, setHeroSlides] = useState<HeroSlide[]>(initial.heroSlides);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);

  function updateSlide(index: number, key: keyof HeroSlide, value: string) {
    setHeroSlides((slides) =>
      slides.map((slide, slideIndex) =>
        slideIndex === index ? { ...slide, [key]: value } : slide,
      ),
    );
  }

  function addSlide() {
    setHeroSlides((slides) => [
      ...slides,
      {
        eyebrow: "Konten baru",
        title: "Judul slide baru",
        description: "Deskripsi singkat slide.",
        imageUrl: "",
        href: "/register",
      },
    ]);
  }

  async function uploadImage(index: number, file?: File) {
    if (!file) return;
    setUploadingIndex(index);
    setError(null);
    setMsg(null);

    try {
      const body = new FormData();
      body.append("image", file);
      const res = await fetch("/api/uploads/hero", {
        method: "POST",
        body,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Gagal mengunggah gambar");
        return;
      }
      updateSlide(index, "imageUrl", data.url);
      setMsg(`Gambar slide ${index + 1} berhasil diunggah.`);
    } catch {
      setError("Tidak dapat mengunggah gambar");
    } finally {
      setUploadingIndex(null);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          min_redemption: Number(form.min_redemption),
          default_qr_rotation_seconds: Number(form.default_qr_rotation_seconds),
          points_to_rupiah: Number(form.points_to_rupiah),
          landing_hero_slides: JSON.stringify(heroSlides),
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d?.error ?? "Gagal menyimpan konfigurasi");
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
                onChange={(e) => setForm((f) => ({ ...f, min_redemption: e.target.value }))}
              />
            </FormField>
            <FormField label="Rotasi QR default (detik)" htmlFor="cfg-qr">
              <Input
                id="cfg-qr"
                type="number"
                value={form.default_qr_rotation_seconds}
                onChange={(e) =>
                  setForm((f) => ({ ...f, default_qr_rotation_seconds: e.target.value }))
                }
              />
            </FormField>
            <FormField label="1 poin = Rp" htmlFor="cfg-pts">
              <Input
                id="cfg-pts"
                type="number"
                value={form.points_to_rupiah}
                onChange={(e) => setForm((f) => ({ ...f, points_to_rupiah: e.target.value }))}
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Carousel Landing Page</CardTitle>
              <p className="mt-1 text-sm text-muted">
                Unggah JPG, PNG, atau WebP maksimal 6 MB. URL tetap dapat dipakai.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={addSlide}
              disabled={heroSlides.length >= 6}
            >
              <Plus /> Tambah Slide
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {heroSlides.map((slide, index) => (
            <div
              key={index}
              className="rounded-2xl border border-border bg-slate-50/60 p-4"
            >
              <div className="mb-4 flex items-center justify-between">
                <p className="font-semibold text-foreground">Slide {index + 1}</p>
                {heroSlides.length > 1 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setHeroSlides((slides) =>
                        slides.filter((_, slideIndex) => slideIndex !== index),
                      )
                    }
                  >
                    <Trash /> Hapus
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <div
                    className="relative aspect-[16/7] overflow-hidden rounded-xl border border-border bg-emerald-950 bg-cover bg-center"
                    style={
                      slide.imageUrl
                        ? {
                            backgroundImage: `linear-gradient(to top, rgba(3,53,39,.6), transparent), url("${slide.imageUrl.replaceAll('"', "%22")}")`,
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
                      {uploadingIndex === index ? "Mengunggah..." : "Upload gambar"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        disabled={uploadingIndex !== null}
                        onChange={(event) => {
                          void uploadImage(index, event.target.files?.[0]);
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
                      updateSlide(index, "eyebrow", event.target.value)
                    }
                    maxLength={60}
                  />
                </FormField>
                <FormField label="Tautan tujuan">
                  <Input
                    value={slide.href}
                    onChange={(event) =>
                      updateSlide(index, "href", event.target.value)
                    }
                    placeholder="/register"
                  />
                </FormField>
                <FormField label="Judul" className="sm:col-span-2" required>
                  <Input
                    value={slide.title}
                    onChange={(event) =>
                      updateSlide(index, "title", event.target.value)
                    }
                    maxLength={140}
                    required
                  />
                </FormField>
                <FormField label="Deskripsi" className="sm:col-span-2">
                  <Input
                    value={slide.description}
                    onChange={(event) =>
                      updateSlide(index, "description", event.target.value)
                    }
                    maxLength={180}
                  />
                </FormField>
                <FormField
                  label="URL / path gambar"
                  hint="Terisi otomatis setelah upload. Bisa diganti dengan URL HTTPS."
                  className="sm:col-span-2"
                >
                  <Input
                    value={slide.imageUrl}
                    onChange={(event) =>
                      updateSlide(index, "imageUrl", event.target.value)
                    }
                    placeholder="https://... atau /images/hero.jpg"
                  />
                </FormField>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Button type="submit" size="lg" disabled={busy}>
        {busy ? "Menyimpan..." : "Simpan Semua Konfigurasi"}
      </Button>
    </form>
  );
}
