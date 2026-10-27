import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandLogo } from "@/components/BrandLogo";
import { buttonVariants } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/FormField";
import { STATUS_KEYS, StatusBadge } from "@/components/ui/StatusBadge";

// Editorial base primitives (spec: "Logged-in app (dashboard style B)").

const render = (element: Parameters<typeof renderToStaticMarkup>[0]) => {
  const html = renderToStaticMarkup(element);
  expect(html).not.toMatch(/\sstyle=/);
  return html;
};

describe("Button", () => {
  it("is an ink pill that turns lime in dark mode", () => {
    const classes = buttonVariants();
    for (const c of ["bg-ink", "text-on-ink", "hover:bg-ink-hover", "rounded-full", "dark:bg-lime", "dark:text-ink"]) {
      expect(classes).toContain(c);
    }
  });

  it("draws outline buttons with the input border", () => {
    const classes = buttonVariants({ variant: "outline" });
    expect(classes).toContain("border-input-border");
    expect(classes).toContain("rounded-full");
  });

  it("keeps danger on the status error color", () => {
    expect(buttonVariants({ variant: "danger" })).toContain("bg-status-error");
  });
});

describe("Card", () => {
  it("separates with a rule instead of a shadow", () => {
    const html = render(createElement(Card, null, "x"));
    expect(html).toContain("rounded-2xl");
    expect(html).not.toContain("shadow-[");
  });
});

describe("Input", () => {
  it("shows focus with an ink border and a lime ring", () => {
    const html = render(createElement(Input, { "aria-label": "Email" }));
    for (const c of ["border-input-border", "focus:border-foreground", "focus:ring-lime"]) expect(html).toContain(c);
  });
});

describe("StatusBadge", () => {
  it("knows the machine statuses", () => {
    expect(STATUS_KEYS).toEqual(expect.arrayContaining(["ONLINE", "OFFLINE", "FULL", "MAINTENANCE", "ERROR"]));
  });

  it.each(STATUS_KEYS)("renders %s with an icon and a text label", (status) => {
    const html = render(createElement(StatusBadge, { status }));
    expect(html).toContain("<svg");
    expect(html.replace(/<[^>]+>/g, "").trim()).not.toBe("");
    expect(html).toContain("rounded-full");
  });

  it("labels ONLINE in Indonesian", () => {
    expect(render(createElement(StatusBadge, { status: "ONLINE" }))).toContain("Online");
  });
});

describe("BrandLogo", () => {
  it("uses only the light-lettered wordmark on dark surfaces", () => {
    const html = render(createElement(BrandLogo, { width: 128, height: 40, surface: "dark" }));
    expect(html.match(/<img/g)).toHaveLength(1);
    expect(html).toContain('src="/reloop-logo-name-dark.svg"');
  });
});
