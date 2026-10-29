import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConfigEditor } from "@/components/admin/ConfigEditor";
import { UserManager } from "@/components/admin/UserManager";
import { DEFAULT_HERO_SLIDES } from "@/lib/hero-slides";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

/**
 * Form controls in `html` with no accessible name: no aria-label, no
 * `<label for>` naming their id, and not wrapped in a label.
 */
function unlabeledControls(html: string): string[] {
  const forIds = new Set([...html.matchAll(/<label [^>]*for="([^"]+)"/g)].map((m) => m[1]));
  const unlabeled: string[] = [];
  for (const m of html.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
    const tag = m[0];
    if (/type="hidden"/.test(tag) || /aria-label(ledby)?="[^"]+"/.test(tag)) continue;
    const id = tag.match(/\sid="([^"]+)"/)?.[1];
    if (id && forIds.has(id)) continue;
    const before = html.slice(0, m.index);
    if ((before.match(/<label\b/g) ?? []).length > (before.match(/<\/label>/g) ?? []).length) continue;
    unlabeled.push(tag);
  }
  return unlabeled;
}

describe("superadmin form controls have an accessible name", () => {
  it("names the role and status select of each user row", () => {
    const html = renderToStaticMarkup(
      createElement(UserManager, {
        organizations: [{ id: "o1", name: "Org A" }],
        users: [
          {
            id: "u1",
            name: "Budi",
            email: "budi@example.com",
            role: "USER",
            status: "ACTIVE",
            organizationId: null,
            organizationName: null,
          },
        ],
      }),
    );
    expect(html).toMatch(/<select[^>]*aria-label="Peran Budi"/);
    expect(html).toMatch(/<select[^>]*aria-label="Status Budi"/);
    expect(unlabeledControls(html)).toEqual([]);
  });

  it("ties every hero slide field to its label", () => {
    const html = renderToStaticMarkup(
      createElement(ConfigEditor, {
        initial: {
          minRedemption: 10_000,
          qrRotation: 30,
          pointsToRupiah: 1,
          landingSlides: DEFAULT_HERO_SLIDES,
          mobileSlides: DEFAULT_HERO_SLIDES,
        },
      }),
    );
    expect(unlabeledControls(html)).toEqual([]);
    // Ids stay unique across the landing and mobile editors.
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
