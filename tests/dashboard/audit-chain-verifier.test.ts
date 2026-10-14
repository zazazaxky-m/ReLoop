import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuditChainResult, describeAuditVerification, type AuditVerifyResult } from "@/components/security/AuditChainVerifier";

const base: AuditVerifyResult = {
  valid: true, checkedVersion: 2, checkedCount: 7, legacyStatus: "not-present", legacyCount: 0, legacyCheckpoint: "not-required",
};

const lines = (result: AuditVerifyResult) => describeAuditVerification(result).map((line) => `${line.label}: ${line.text}`);

describe("AuditChainVerifier messages (A05)", () => {
  it("shows the new chain and the legacy archive on separate lines", () => {
    expect(lines(base)).toEqual([
      "Rantai audit baru: Valid. 7 entri diperiksa sesuai nomor urut.",
      "Arsip audit lama: Tidak ada entri lama.",
    ]);
  });

  it("never calls an unverifiable legacy archive valid, and keeps the chain verdict on its own", () => {
    const result = { ...base, legacyStatus: "unverifiable" as const, legacyCount: 120, legacyCheckpoint: "missing" as const };
    const text = lines(result);
    expect(text[0]).toBe("Rantai audit baru: Valid. 7 entri diperiksa sesuai nomor urut.");
    expect(text[1]).toMatch(/^Arsip audit lama: 120 entri lama tidak dapat diverifikasi\./);
    expect(text[1]).toContain("tidak ditandatangani ulang");
    expect(text[1]).not.toContain("cocok");
    expect(text[1]).not.toMatch(/\bvalid\b/i);
    expect(text[2]).toBe("Checkpoint arsip lama: Checkpoint arsip lama belum dicatat.");
    expect(describeAuditVerification(result)[1].tone).toBe("warn");
  });

  it("states a provable legacy archive and the checkpoint outcome", () => {
    expect(lines({ ...base, legacyStatus: "valid", legacyCount: 3, legacyCheckpoint: "matches" })).toEqual([
      "Rantai audit baru: Valid. 7 entri diperiksa sesuai nomor urut.",
      "Arsip audit lama: 3 entri lama cocok dengan checksum yang tersimpan. Dilaporkan terpisah dari rantai baru.",
      "Checkpoint arsip lama: Arsip lama tidak berubah sejak checkpoint dicatat.",
    ]);
    expect(lines({ ...base, legacyStatus: "unverifiable", legacyCount: 3, legacyCheckpoint: "mismatch" })[2])
      .toBe("Checkpoint arsip lama: Arsip lama berubah sejak checkpoint dicatat. Laporkan ke tim keamanan.");
  });

  it("explains where and why the new chain broke, independent of the legacy status", () => {
    const text = lines({ ...base, valid: false, brokenAt: "row-9", reason: "sequence", legacyStatus: "valid", legacyCount: 2 });
    expect(text[0]).toBe("Rantai audit baru: Rusak pada entri row-9: nomor urut terputus atau tidak berurutan.");
    expect(text[1]).toMatch(/^Arsip audit lama: 2 entri lama cocok/);
  });

  it("renders every line as markup", () => {
    const html = renderToStaticMarkup(createElement(AuditChainResult, {
      result: { ...base, legacyStatus: "unverifiable", legacyCount: 4, legacyCheckpoint: "missing" },
    }));
    expect(html).toContain("Rantai audit baru");
    expect(html).toContain("4 entri lama tidak dapat diverifikasi");
    expect(html).toContain("text-amber-700");
  });
});
