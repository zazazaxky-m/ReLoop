import type { Metadata, Viewport } from "next";
import "./globals.css";

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "ReLoop";

export const metadata: Metadata = {
  title: {
    default: appName,
    template: `%s | ${appName}`,
  },
  description:
    "Platform pengelolaan sampah digital untuk penyetoran, reward, operasional mesin, dan pengambilan material.",
  manifest: "/manifest.webmanifest",
  applicationName: appName,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ReLoop",
  },
};

export const viewport: Viewport = {
  themeColor: "#16a34a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
