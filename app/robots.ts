import type { MetadataRoute } from "next";
import { absoluteUrl, siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/dashboard/",
        "/kiosk/",
        "/machine/",
        "/print/",
        "/scan",
        "/map",
        "/forgot-password",
        "/reset-password",
      ],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: siteUrl().origin,
  };
}
