import { describe, expect, it } from "vitest";
import { isTokenValid } from "@/lib/qr";
import {
  machineAcceptsSessions,
  transitionSession,
  validateSensorSequence,
} from "@/lib/machine-state";
import { validateWeight, computeRewardAmount } from "@/lib/reward";
import { isCampaignEligible, normalizeEmailDomains } from "@/lib/campaign";
import { assertAppendOnlyPolicy } from "@/lib/ledger";

describe("QR token validation", () => {
  it("rejects expired tokens", () => {
    const machine = {
      qrToken: "abc",
      qrTokenExpiresAt: new Date(Date.now() - 1000),
    };
    expect(isTokenValid(machine, "abc")).toBe(false);
  });

  it("rejects token mismatch (replay)", () => {
    const machine = {
      qrToken: "valid",
      qrTokenExpiresAt: new Date(Date.now() + 60_000),
    };
    expect(isTokenValid(machine, "wrong")).toBe(false);
  });

  it("accepts valid non-expired token", () => {
    const machine = {
      qrToken: "valid",
      qrTokenExpiresAt: new Date(Date.now() + 60_000),
    };
    expect(isTokenValid(machine, "valid")).toBe(true);
  });
});

describe("machine session acceptance", () => {
  it("blocks FULL and MAINTENANCE machines", () => {
    expect(machineAcceptsSessions("ONLINE")).toBe(true);
    expect(machineAcceptsSessions("FULL")).toBe(false);
    expect(machineAcceptsSessions("MAINTENANCE")).toBe(false);
  });
});

describe("session state machine", () => {
  it("transitions ACTIVE to PROCESSING_ITEM on START_ITEM", () => {
    expect(transitionSession("ACTIVE", "START_ITEM")).toBe("PROCESSING_ITEM");
  });

  it("transitions PROCESSING_ITEM to ACTIVE on ITEM_DONE", () => {
    expect(transitionSession("PROCESSING_ITEM", "ITEM_DONE")).toBe("ACTIVE");
  });

  it("transitions to REVIEW on anomaly", () => {
    expect(transitionSession("PROCESSING_ITEM", "ANOMALY")).toBe("REVIEW");
  });
});

describe("sensor sequence anomaly", () => {
  it("flags reverse motion", () => {
    expect(validateSensorSequence({ reverseMotion: true })).toBe("REVERSE_MOTION");
  });

  it("flags retrieval attempt", () => {
    expect(validateSensorSequence({ retrievalAttempt: true })).toBe(
      "RETRIEVAL_ATTEMPT",
    );
  });

  it("flags impossible step order", () => {
    expect(
      validateSensorSequence({
        steps: ["ACCEPTANCE_POINT", "CHAMBER_OPEN"],
      }),
    ).toBe("IMPOSSIBLE_SEQUENCE");
  });

  it("accepts forward sequence", () => {
    expect(
      validateSensorSequence({
        steps: ["CHAMBER_OPEN", "WEIGHT_STABLE", "ACCEPTANCE_POINT"],
      }),
    ).toBeNull();
  });
});

describe("weight threshold validation", () => {
  it("rejects weight above max (water-filled bottle)", () => {
    const r = validateWeight(120, 5, 80);
    expect(r.valid).toBe(false);
    expect(r.reasonCode).toBe("WEIGHT_ABOVE_MAX");
  });

  it("rejects weight below min", () => {
    const r = validateWeight(2, 5, 80);
    expect(r.valid).toBe(false);
    expect(r.reasonCode).toBe("WEIGHT_BELOW_MIN");
  });

  it("accepts weight in range", () => {
    expect(validateWeight(22, 5, 80).valid).toBe(true);
  });
});

describe("reward computation", () => {
  it("computes per-item reward with campaign multiplier", () => {
    expect(computeRewardAmount(200, 1, 1.2)).toBe(240);
  });
});

describe("private campaign email domain", () => {
  it("allows matching domain", () => {
    const r = isCampaignEligible(
      {
        visibility: "PRIVATE",
        allowedEmailDomainsJson: ["@telkomuniversity.ac.id"],
        status: "ACTIVE",
        startAt: new Date(Date.now() - 86_400_000),
        endAt: new Date(Date.now() + 86_400_000),
      },
      "student@telkomuniversity.ac.id",
    );
    expect(r.eligible).toBe(true);
  });

  it("rejects non-matching domain", () => {
    const r = isCampaignEligible(
      {
        visibility: "PRIVATE",
        allowedEmailDomainsJson: ["@telkomuniversity.ac.id"],
        status: "ACTIVE",
        startAt: null,
        endAt: null,
      },
      "user@gmail.com",
    );
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("EMAIL_DOMAIN_MISMATCH");
  });

  it("allows public campaigns for any email", () => {
    const r = isCampaignEligible(
      {
        visibility: "PUBLIC",
        allowedEmailDomainsJson: null,
        status: "ACTIVE",
        startAt: null,
        endAt: null,
      },
      "anyone@example.com",
    );
    expect(r.eligible).toBe(true);
  });
});

describe("normalizeEmailDomains", () => {
  it("prefixes @ and lowercases", () => {
    expect(normalizeEmailDomains(["Telkomuniversity.ac.id"])).toEqual([
      "@telkomuniversity.ac.id",
    ]);
  });

  it("dedupes and drops invalid entries", () => {
    expect(
      normalizeEmailDomains(["@gmail.com", "gmail.com", "not-a-domain", ""]),
    ).toEqual(["@gmail.com"]);
  });
});

describe("append-only ledger policy", () => {
  it("throws on update/delete attempts", () => {
    expect(() => assertAppendOnlyPolicy("update")).toThrow(/append-only/i);
    expect(() => assertAppendOnlyPolicy("delete")).toThrow(/append-only/i);
  });
});
