export const SITE_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "ReLoop";

export const SITE_DESCRIPTION =
  "ReLoop adalah platform bank sampah digital: setor sampah daur ulang di mesin ReLoop, kumpulkan reward transparan, dan pantau dampak lingkunganmu.";

// Read at request time so the deployed NEXT_PUBLIC_BASE_URL is used for
// canonical, Open Graph, robots, and sitemap URLs instead of a build-time value.
export function siteUrl(): URL {
  return new URL(process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000");
}

export function absoluteUrl(path = "/"): string {
  return new URL(path, siteUrl()).toString();
}
