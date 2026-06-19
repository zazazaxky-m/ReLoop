export type HeroSlide = {
  eyebrow: string;
  title: string;
  description: string;
  imageUrl: string;
  href: string;
};

export const DEFAULT_HERO_SLIDES: HeroSlide[] = [
  {
    eyebrow: "Gerakan sirkular",
    title: "Yang terbuang bisa kembali bernilai.",
    description: "Setor, catat, dan putar kembali.",
    imageUrl: "/hero-ai-community.webp",
    href: "/register",
  },
  {
    eyebrow: "Aksi bersama",
    title: "Kebiasaan kecil, dampak untuk satu kota.",
    description: "Warga, organisasi, dan pengepul bergerak dalam satu alur.",
    imageUrl: "/hero-ai-community.webp",
    href: "/register",
  },
  {
    eyebrow: "Reward transparan",
    title: "Setiap setoran tercatat dan mudah dipantau.",
    description: "Lihat progres dan reward langsung dari dashboard ReLoop.",
    imageUrl: "/hero-ai-community.webp",
    href: "/login",
  },
];

function isSafeUrl(value: string) {
  return (
    value === "" ||
    value.startsWith("/") ||
    value.startsWith("https://") ||
    value.startsWith("http://")
  );
}

export function parseHeroSlides(value?: string | null): HeroSlide[] {
  if (!value) return DEFAULT_HERO_SLIDES;

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return DEFAULT_HERO_SLIDES;

    const slides = parsed
      .slice(0, 6)
      .map((slide): HeroSlide | null => {
        if (!slide || typeof slide !== "object") return null;
        const item = slide as Record<string, unknown>;
        const eyebrow = String(item.eyebrow ?? "").trim().slice(0, 60);
        const title = String(item.title ?? "").trim().slice(0, 140);
        const description = String(item.description ?? "").trim().slice(0, 180);
        const imageUrl =
          String(item.imageUrl ?? "").trim().slice(0, 1000) ||
          "/hero-ai-community.webp";
        const href = String(item.href ?? "/register").trim().slice(0, 500);

        if (!title || !isSafeUrl(imageUrl) || !isSafeUrl(href)) return null;
        return { eyebrow, title, description, imageUrl, href };
      })
      .filter((slide): slide is HeroSlide => slide !== null);

    return slides.length ? slides : DEFAULT_HERO_SLIDES;
  } catch {
    return DEFAULT_HERO_SLIDES;
  }
}
