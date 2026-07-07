import { readFile } from "fs/promises";
import path from "path";

import { NextResponse } from "next/server";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** Only hero/marketing assets — not arbitrary public/ files. */
function isAllowedHeroPath(normalized: string): boolean {
  if (!normalized || normalized.includes("..")) return false;
  const ext = path.extname(normalized).toLowerCase();
  if (!CONTENT_TYPES[ext]) return false;
  if (normalized.startsWith("images/hero/")) return true;
  const base = path.basename(normalized);
  return base.startsWith("hero-") || base.startsWith("hero_");
}

export async function GET(req: Request) {
  const requested = new URL(req.url).searchParams.get("path") ?? "";
  const normalized = requested.replaceAll("\\", "/").replace(/^\/+/, "");
  const publicRoot = path.resolve(process.cwd(), "public");
  const filePath = path.resolve(publicRoot, normalized);
  const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()];

  if (
    !isAllowedHeroPath(normalized) ||
    !filePath.startsWith(`${publicRoot}${path.sep}`) ||
    !contentType
  ) {
    return NextResponse.json({ error: "Gambar tidak valid" }, { status: 400 });
  }

  try {
    const bytes = await readFile(filePath);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Gambar tidak ditemukan" },
      { status: 404 },
    );
  }
}
