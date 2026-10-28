import { BrandLogo } from "@/components/BrandLogo";
import { preloadEditorialFonts } from "@/lib/fonts";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Layout for public-facing legal pages (privacy policy, terms of service).
 * Uses a simple centered column with the brand logo and a back-to-home link
 * so the pages are easy to reach from external links (Play Store, App Store,
 * GitHub, support emails, etc.).
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  preloadEditorialFonts();
  return (
    <div className="min-h-dvh text-foreground">
      <header className="border-b border-rule-strong">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center" aria-label="ReLoop beranda">
            <BrandLogo
              width={125}
              height={37}
              priority
              className="h-8 w-auto sm:h-9"
            />
          </Link>
          <Link
            href="/"
            className="text-sm font-bold text-foreground underline decoration-1 underline-offset-4 hover:decoration-2"
          >
            ← Beranda
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        {children}
      </main>

      <footer className="border-t border-rule-strong">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-2 px-5 py-6 text-xs text-muted sm:flex-row sm:justify-between sm:px-8">
          <p>&copy; {new Date().getFullYear()} ReLoop</p>
          <nav aria-label="Tautan legal" className="flex items-center gap-4">
            <Link
              href="/privacy"
              className="font-semibold text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              Kebijakan Privasi
            </Link>
            <Link
              href="/terms"
              className="font-semibold text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              Syarat &amp; Ketentuan
            </Link>
            <Link
              href="/account-deletion"
              className="font-semibold text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              Hapus Akun
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
