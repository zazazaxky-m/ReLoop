import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { PickupManager, type PickupRow } from "@/components/pickup/PickupManager";
import { EMPTY_TASKS_TITLE, PickupTaskList, type TaskRow } from "@/components/pickup/PickupTaskList";
import { describePickupDispatch } from "@/lib/pickup";

const NOW = new Date("2026-10-14T10:00:00Z");
const SELF_CLAIM = /Ambil Tugas|ambil sendiri|klaim|self-assign/i;

function adminRow(overrides: Partial<PickupRow> & Pick<PickupRow, "status">): PickupRow {
  const base = {
    id: `p-${overrides.status}`, machineName: "Mesin Uji", machineCode: "UJI-1", organizationName: "",
    reason: "FULL", priority: 1, assignedCollectorName: null, itemCount: 0, version: 0,
    assignedAt: null, expectedStartAt: null, closedReason: null,
  };
  const row = { ...base, ...overrides } as PickupRow;
  return { ...row, dispatch: describePickupDispatch({ status: row.status as never, expectedStartAt: row.expectedStartAt }, NOW) };
}

describe("pickup dispatch UI (B05)", () => {
  it("collector empty state waits for admin assignment and promises no self-assign", () => {
    const html = renderToStaticMarkup(createElement(PickupTaskList, { tasks: [], wasteTypes: [] }));
    expect(html).toContain(EMPTY_TASKS_TITLE);
    expect(EMPTY_TASKS_TITLE).toBe("Menunggu penugasan admin");
    expect(html).toContain("Admin organisasi mitra menugaskan setiap pickup kepada satu pengepul");
    expect(html).not.toMatch(SELF_CLAIM);
  });

  it("collector task shows the next step, dispatch time and the operator's deadline", () => {
    const task: TaskRow = {
      id: "t1", machineName: "Mesin Uji", machineCode: "UJI-1", organizationName: "Org", contactName: null,
      contactPhone: null, address: null, status: "ASSIGNED", reason: "FULL", items: [], version: 2,
      assignedAt: "2026-10-14T08:00:00Z", expectedStartAt: "2026-10-14T09:00:00Z", closedReason: null,
      dispatch: describePickupDispatch({ status: "ASSIGNED", expectedStartAt: "2026-10-14T09:00:00Z" }, NOW),
    };
    const html = renderToStaticMarkup(createElement(PickupTaskList, { tasks: [task], wasteTypes: [] }));
    expect(html.replace(/<!-- -->/g, "")).toContain("Langkah berikutnya: Terlambat: pengepul belum berangkat");
    expect(html).toContain("Tenggat mulai:");
    expect(html).toContain("(terlambat)");
    expect(html).toContain("Ditugaskan");
    expect(html).not.toMatch(SELF_CLAIM);
  });

  it("admin list shows the PIC, next status, dispatch time, deadline and the replacement path", () => {
    const rows = [
      adminRow({ status: "ASSIGNED", assignedCollectorName: "Pengepul Satu", version: 3,
        assignedAt: "2026-10-14T08:00:00Z", expectedStartAt: "2026-10-14T09:00:00Z" }),
      adminRow({ status: "REQUESTED" }),
      adminRow({ status: "FAILED", assignedCollectorName: "Pengepul Dua", closedReason: "Akses jalan ditutup" }),
    ];
    const html = renderToStaticMarkup(createElement(PickupManager, {
      pickups: rows, machines: [], activePartners: [{ id: "c1", name: "Pengepul Satu" }],
    }));
    expect(html).toContain("Pengepul (PIC)");
    expect(html).toContain("Pengepul Satu");
    expect(html).toContain("Ditugaskan");
    expect(html).toContain("Terlambat: pengepul belum berangkat");
    expect(html).toContain("Status berikutnya");
    expect(html).toContain("Dalam Perjalanan");
    expect(html).toContain("(terlambat)");
    expect(html).toContain("Tanpa tenggat");
    expect(html).toContain("Menunggu admin menugaskan pengepul");
    expect(html.replace(/<!-- -->/g, "")).toContain("Alasan: Akses jalan ditutup");
    expect(html).toContain("Buat pengganti");
    expect(html).toContain("Ganti");
  });

  // Flutter is not run in this environment; this is a static guard on the shipped Dart source.
  it("mobile screens drop the self-claim tab and send expectedVersion (static source check)", () => {
    const read = (file: string) => readFileSync(path.resolve(__dirname, "../../mobile/lib/features", file), "utf8");
    const collector = read("pickup/pickup_screen.dart");
    expect(collector).toContain("'Menunggu penugasan admin'");
    expect(collector).not.toContain("Ambil Tugas Ini");
    expect(collector).not.toContain("'scope': 'available'");
    expect(collector).toContain("body['expectedVersion'] = version");
    const admin = read("admin/admin_pickups_screen.dart");
    expect(admin).toContain("body['expectedVersion'] = version");
    expect(admin).toContain("'Alasan pembatalan'");
  });
});
