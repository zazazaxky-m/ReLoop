import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/ThemeProvider";
import { NONCE_HEADER } from "@/lib/security-headers";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/site";
import "./globals.css";

const jakarta = localFont({
  src: "../public/fonts/plus-jakarta-sans-latin.woff2",
  variable: "--font-jakarta",
  display: "swap",
});

export function generateMetadata(): Metadata {
  return {
    metadataBase: siteUrl(),
    title: {
      default: SITE_NAME,
      template: `%s | ${SITE_NAME}`,
    },
    description: SITE_DESCRIPTION,
    keywords: [
      "bank sampah digital",
      "setor sampah",
      "daur ulang",
      "reward sampah",
      "mesin sampah",
      "pengepul",
      "pengelolaan sampah",
      "ReLoop",
    ],
    manifest: "/manifest.webmanifest",
    applicationName: SITE_NAME,
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: SITE_NAME,
    },
    formatDetection: { telephone: false },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "id_ID",
    },
    twitter: {
      card: "summary_large_image",
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#16a34a",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;

  return (
    <html
      lang="id"
      className={jakarta.variable}
      suppressHydrationWarning
      nonce={nonce}
    >
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          nonce={nonce}
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
