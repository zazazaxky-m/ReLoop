import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FillLevelBar } from "@/components/machine/FillLevelBar";
import { DataTable } from "@/components/ui/DataTable";
import { MetricCard } from "@/components/ui/MetricCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { QuickAction } from "@/components/ui/QuickAction";

// Dashboard primitives in direction "B · Berkarakter" (spec: "Logged-in app").

const render = (element: Parameters<typeof renderToStaticMarkup>[0]) => {
  const html = renderToStaticMarkup(element);
  expect(html).not.toMatch(/\sstyle=/);
  return html;
};

describe("PageHeader", () => {
  it("renders the eyebrow as a tilted lime tag", () => {
    const html = render(createElement(PageHeader, { title: "Dashboard Admin", eyebrow: "Selasa, 27 Oktober" }));
    expect(html).toMatch(/<[^>]*class="[^"]*bg-lime[^"]*-rotate-\[1\.5deg\][^"]*"[^>]*>Selasa, 27 Oktober</);
    expect(html).not.toContain("bg-brand-500");
  });

  it("has no lime without an eyebrow", () => {
    const html = render(createElement(PageHeader, { title: "Dashboard Admin" }));
    expect(html).not.toContain("bg-lime");
    expect(html).not.toContain("bg-brand-500");
  });
});

describe("MetricCard", () => {
  it("sets the value in Anton", () => {
    expect(render(createElement(MetricCard, { label: "Mesin", value: 24 }))).toMatch(/class="[^"]*font-display[^"]*">24</);
  });

  it("ignores the legacy tone prop", () => {
    const green = render(createElement(MetricCard, { label: "Mesin", value: 24, tone: "green" }));
    const amber = render(createElement(MetricCard, { label: "Mesin", value: 24, tone: "amber" }));
    expect(green).toBe(amber);
  });

  it("inverts to ink with a lime value only when emphasized", () => {
    const on = render(createElement(MetricCard, { label: "Perlu perhatian", value: 2, emphasis: true }));
    expect(on).toContain('data-emphasis="true"');
    expect(on).toContain("bg-ink");
    expect(on).toContain("text-lime");
    const off = render(createElement(MetricCard, { label: "Perlu perhatian", value: 2, emphasis: false }));
    for (const c of ['data-emphasis="true"', "bg-ink", "text-lime"]) expect(off).not.toContain(c);
  });
});

describe("QuickAction", () => {
  it("numbers the action in Anton instead of an icon chip", () => {
    const html = render(createElement(QuickAction, { href: "/x", title: "Laporan", description: "Lihat data.", index: 3 }));
    expect(html).toMatch(/class="[^"]*font-display[^"]*"[^>]*>03</);
    for (const c of ["bg-brand-600", "bg-blue-600", "bg-amber-500", "bg-teal-600"]) expect(html).not.toContain(c);
  });
});

describe("DataTable", () => {
  it("heads columns in ink over a strong rule, without a shadow", () => {
    const html = render(
      createElement(DataTable<{ id: string }>, {
        columns: [{ key: "id", header: "Mesin" }],
        rows: [{ id: "RL-0012" }],
        getRowKey: (row) => row.id,
      }),
    );
    expect(html).toMatch(/<th[^>]*class="[^"]*text-foreground/);
    expect(html).toContain("border-rule-strong");
    expect(html).not.toContain("shadow");
  });
});

describe("FillLevelBar", () => {
  it("fills with ink, lime in dark mode", () => {
    const html = render(createElement(FillLevelBar, { percent: 50 }));
    expect(html).toContain("fill-ink");
    expect(html).toContain("dark:fill-lime");
  });

  it("turns amber when nearly full", () => {
    expect(render(createElement(FillLevelBar, { percent: 85 }))).toContain("fill-amber-500");
  });
});
