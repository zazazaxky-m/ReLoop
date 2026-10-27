import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AuthLayout from "@/app/(auth)/layout";
import AcceptInvitationPage from "@/app/(auth)/accept-invitation/page";
import ForgotPasswordPage from "@/app/(auth)/forgot-password/page";
import LoginPage from "@/app/(auth)/login/page";
import RegisterPage from "@/app/(auth)/register/page";
import ResetPasswordPage from "@/app/(auth)/reset-password/page";
import VerifyEmailPage from "@/app/(auth)/verify-email/page";
import { AuthForm } from "@/components/auth/AuthForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// An async server component that reads request headers; it renders only a script.
vi.mock("@/components/auth/LinkTokenCapture", () => ({ LinkTokenCapture: () => null }));

// Public pages from docs/superpowers/specs/2026-10-27-app-editorial-theme-design.md
// ("Public pages"): the auth poster built from landing artwork.

/** The first element `<tag ...>...</tag>` in `html`; auth markup never nests the tag. */
function element(html: string, tag: string): string {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`));
  if (!match) throw new Error(`no <${tag}> in markup`);
  return match[0];
}

/** Anchors whose href is exactly `href`, without crossing into the next anchor. */
function links(html: string, href: string): string[] {
  const escaped = href.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return html.match(new RegExp(`<a\\b[^>]*href="${escaped}"[^>]*>(?:(?!</a>)[\\s\\S])*</a>`, "g")) ?? [];
}

describe("auth layout", () => {
  const html = renderToStaticMarkup(AuthLayout({ children: createElement("h1", null, "Masuk ke ReLoop") }));
  const poster = element(html, "aside");
  const posterTag = poster.slice(0, poster.indexOf(">") + 1);

  it("builds the poster from the landing artwork", () => {
    for (const asset of [
      "/landing/heading-v2.webp",
      "/landing/slogan-v2.webp",
      "/landing/bottle-v2.webp",
      "/landing/mark.svg",
    ]) {
      expect(poster).toContain(asset);
    }
    expect(poster).toContain("SETOR. PUTAR. ULANG.");
  });

  it("keeps the poster decorative", () => {
    expect(posterTag).toContain('aria-hidden="true"');
    const images = poster.match(/<img\b[^>]*>/g) ?? [];
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) expect(img).toContain('alt=""');
    expect(poster).not.toMatch(/<a\b/);
  });

  it("keeps the poster on light paper in dark mode", () => {
    for (const c of ["light-island", "bg-background", "text-foreground"]) expect(posterTag).toContain(c);
  });

  it("sets the poster band in the display face", () => {
    expect(poster).toMatch(/<[^>]*class="[^"]*font-display[^"]*"[^>]*>(?:(?!<\/div>)[\s\S])*SETOR\. PUTAR\. ULANG\./);
  });

  it("leaves the form's heading as the only h1", () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });

  it("links back to the landing page", () => {
    expect(links(html, "/").some((a) => a.includes("Kembali ke beranda"))).toBe(true);
  });

  it("uses no inline styles and none of the old green panel", () => {
    expect(html).not.toContain("style=");
    for (const old of ["bg-brand-950", "lime-300", "shadow-[0_24px"]) expect(html).not.toContain(old);
  });
});

describe("auth form", () => {
  const login = renderToStaticMarkup(createElement(AuthForm, { mode: "login", next: "/accept-invitation" }));
  const register = renderToStaticMarkup(createElement(AuthForm, { mode: "register" }));

  it("submits with a full-width ink pill and a trailing arrow", () => {
    const button = login.match(/<button\b[^>]*type="submit"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(button).toContain("w-full");
    expect(button).toContain("justify-between");
    expect(button).toContain("<svg");
    expect(button).not.toMatch(/bg-brand-600|shadow-\[/);
  });

  it("offers the other mode as an outline pill that keeps next", () => {
    const [signUp] = links(login, "/register?next=%2Faccept-invitation");
    expect(signUp).toBeDefined();
    expect(signUp).toContain("rounded-full");
    expect(signUp).toContain("border-foreground");
    expect(signUp).toContain("Daftar");
    expect(login).toContain("Belum punya akun?");

    const [signIn] = links(register, "/login");
    expect(signIn).toContain("rounded-full");
    expect(signIn).toContain("Masuk");
    expect(register).toContain("Sudah punya akun?");
  });

  it("underlines its text links in the foreground color", () => {
    const [forgot] = links(login, "/forgot-password");
    expect(forgot).toContain("text-foreground");
    expect(forgot).toContain("underline");
    for (const href of ["/terms", "/privacy"]) {
      const [link] = links(register, href);
      expect(link).toContain("text-foreground");
      expect(link).toContain("underline");
    }
    expect(login + register).not.toMatch(/text-brand-700|bg-brand-600/);
  });
});

describe("auth pages", () => {
  it.each([
    ["login", () => LoginPage({ searchParams: Promise.resolve({ reset: "1" }) })],
    ["register", () => RegisterPage({ searchParams: Promise.resolve({}) })],
    ["forgot-password", ForgotPasswordPage],
    ["reset-password", () => ResetPasswordPage({ searchParams: Promise.resolve({ token: "t" }) })],
    ["reset-password without a token", () => ResetPasswordPage({ searchParams: Promise.resolve({}) })],
    ["verify-email", VerifyEmailPage],
    ["accept-invitation", AcceptInvitationPage],
  ] as [string, () => React.ReactElement | Promise<React.ReactElement>][])(
    "%s uses the editorial heading and no old green accents",
    async (_name, page) => {
      const html = renderToStaticMarkup(await page());
      expect(html.match(/<h1\b[^>]*>/)?.[0]).toContain("tracking-[-0.06em]");
      expect(html).not.toMatch(/text-brand-[67]00|bg-brand-600|font-black|shadow-\[/);
    },
  );
});
