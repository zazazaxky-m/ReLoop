import { describe, expect, it } from "vitest";
import { ERASED_DATA, PUBLIC_REQUEST_MESSAGE, RETAINED_DATA, describeErasure, resolutionSteps, type ErasureStatus } from "./erasure-copy";

const none = { available: 0, pending: 0, reserved: 0, openRedemptions: 0, openSessions: 0, openTrips: 0 };
const STATUSES: ErasureStatus[] = ["PENDING", "VERIFIED", "PROCESSING", "PENDING_RECONCILIATION", "RETRYABLE_FAILED", "COMPLETED", "REJECTED"];

describe("erasure copy", () => {
  it("never claims that every piece of data is gone, and always lists what is kept", () => {
    const all = [...ERASED_DATA, ...RETAINED_DATA, PUBLIC_REQUEST_MESSAGE,
      ...STATUSES.flatMap((status) => [true, false].map((accountErased) =>
        describeErasure({ status, accountErased, obligations: none }).message))].join("\n");
    expect(all).not.toMatch(/(semua|seluruh) data/i);
    expect(all).not.toMatch(/hangus(?!kan)/i);
    expect(RETAINED_DATA.join(" ")).toMatch(/ledger/);
    expect(RETAINED_DATA.join(" ")).toMatch(/kebijakan retensi yang disetujui/);
  });

  it("only COMPLETED reports completion; a failed step never sounds successful", () => {
    for (const status of STATUSES) {
      for (const accountErased of [true, false]) {
        const view = describeErasure({ status, accountErased, obligations: none });
        expect(view.completed).toBe(status === "COMPLETED");
        if (status !== "COMPLETED") expect(view.message).not.toMatch(/berhasil|selesai:/i);
      }
    }
    expect(describeErasure({ status: "RETRYABLE_FAILED", accountErased: true, obligations: null }).message).toMatch(/belum selesai/);
    expect(describeErasure({ status: "PENDING_RECONCILIATION", accountErased: false, obligations: none }).message)
      .toMatch(/belum ada data yang dihapus/i);
  });

  it("gives one resolution step per open obligation, with rupiah amounts, and none when settled", () => {
    expect(resolutionSteps(none)).toEqual([]);
    const steps = resolutionSteps({ available: 15_000, pending: 2_500, reserved: 20_000, openRedemptions: 1, openSessions: 2, openTrips: 1 });
    expect(steps.join("\n")).toMatch(/Rp15\.000/);
    expect(steps.join("\n")).toMatch(/Rp2\.500/);
    expect(steps.join("\n")).toMatch(/1 pengajuan pencairan/);
    expect(steps.join("\n")).toMatch(/2 sesi setoran/);
    expect(steps.join("\n")).toMatch(/1 trip/);
    expect(steps.at(-1)).toMatch(/tidak dihanguskan/);
    // A reserve without an open request (ledger inconsistency) is still explained.
    expect(resolutionSteps({ ...none, reserved: 5_000 }).join(" ")).toMatch(/Rp5\.000 masih tertahan/);
    // Resolution steps only accompany a held request.
    expect(describeErasure({ status: "PROCESSING", accountErased: false, obligations: { ...none, available: 1 } }).resolutionSteps).toEqual([]);
  });
});
