import { NextResponse } from "next/server";

import { CONFIG_KEYS, getAllConfig } from "@/lib/config";
import { DEFAULT_MOBILE_HERO_SLIDES, parseHeroSlides } from "@/lib/hero-slides";

export async function GET() {
  const config = await getAllConfig();
  const slides = parseHeroSlides(
    config[CONFIG_KEYS.MOBILE_HERO_SLIDES],
    DEFAULT_MOBILE_HERO_SLIDES,
  ).map(
    (slide) => ({
      ...slide,
      imageUrl:
        slide.imageUrl.startsWith("http://") ||
        slide.imageUrl.startsWith("https://")
          ? slide.imageUrl
          : `/api/public/hero-image?path=${encodeURIComponent(slide.imageUrl)}`,
    }),
  );

  return NextResponse.json(
    { slides },
    {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}


