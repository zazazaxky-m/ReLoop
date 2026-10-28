import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RedemptionQueue, type RedemptionAdminRow } from "@/components/admin/RedemptionQueue";
import { MachineListTable } from "@/components/machine/MachineListTable";
import { SecurityEventList } from "@/components/security/SecurityEventList";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// Spec (DataTable): "Links are underlined." A link that shows its underline
// only on hover reads as plain text on touch screens and at a glance.

/** Class tokens of the link whose text is `text`. */
function linkClasses(html: string, text: string): string[] {
  for (const [, cls, body] of html.matchAll(/<a [^>]*class="([^"]*)"[^>]*>(.*?)<\/a>/g)) {
    if (body.includes(text)) return cls.split(" ");
  }
  throw new Error(`no link with text ${text}`);
}

function expectUnderlinedAtRest(classes: string[]) {
  expect(classes).toContain("underline");
  expect(classes).not.toContain("hover:underline");
}

describe("table links are underlined at rest", () => {
  it("underlines the machine code in the machine table", () => {
    const html = renderToStaticMarkup(
      createElement(MachineListTable, {
        detailBase: "/dashboard/admin/machines",
        machines: [
          {
            id: "m1",
            machineCode: "RVM-001",
            name: "Mesin Lobi",
            status: "ONLINE",
            fillLevelPercent: 40,
            lastHeartbeatAt: null,
          },
        ],
      }),
    );
    expectUnderlinedAtRest(linkClasses(html, "RVM-001"));
  });

  it("underlines the machine detail link of a security event", () => {
    const html = renderToStaticMarkup(
      createElement(SecurityEventList, {
        events: [
          {
            id: "e1",
            eventType: "FRAUD_DETECTED",
            occurredAt: new Date("2026-10-28T08:00:00Z"),
            receivedAt: new Date("2026-10-28T08:00:01Z"),
            payload: null,
            sessionId: null,
            depositItemId: null,
            machine: {
              id: "m1",
              machineCode: "RVM-001",
              name: "Mesin Lobi",
              status: "ONLINE",
              organization: { id: "o1", name: "Org" },
            },
          },
        ],
      }),
    );
    expectUnderlinedAtRest(linkClasses(html, "Buka detail mesin"));
  });

  // The proof link sits in the queue actions and, once settled, in the history.
  it.each(["PROCESSING", "SUCCESS"])("underlines the transfer proof link of a %s redemption", (status) => {
    const row: RedemptionAdminRow = {
      id: "r1",
      userName: "Budi",
      userEmail: "budi@example.com",
      amount: 5000,
      provider: "DANA",
      accountIdentifier: "0812",
      accountName: "Budi",
      status,
      note: null,
      createdAt: new Date("2026-10-28T08:00:00Z"),
      manualTransferProofUrl: "proof.jpg",
    };
    const html = renderToStaticMarkup(createElement(RedemptionQueue, { redemptions: [row] }));
    expectUnderlinedAtRest(linkClasses(html, "Lihat bukti"));
  });
});
