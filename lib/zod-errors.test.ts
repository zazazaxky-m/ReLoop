import { describe, expect, it } from "vitest";
import { z } from "zod";
import { typeErrors } from "./zod-errors";

const firstMessage = (schema: z.ZodType, input: unknown) =>
  schema.safeParse(input).error?.issues[0]?.message;

describe("typeErrors", () => {
  const amount = z
    .number({ error: typeErrors({ required: "Jumlah wajib diisi", invalidType: "Jumlah harus berupa angka" }) })
    .positive("Jumlah harus lebih dari 0");

  it("answers a missing value with the required message", () => {
    expect(firstMessage(z.object({ amount }), {})).toBe("Jumlah wajib diisi");
  });

  it("answers a value of another type, null included, with the invalid-type message", () => {
    expect(firstMessage(amount, "10")).toBe("Jumlah harus berupa angka");
    expect(firstMessage(amount, null)).toBe("Jumlah harus berupa angka");
  });

  it("leaves check failures to the check's own message", () => {
    expect(firstMessage(amount, -1)).toBe("Jumlah harus lebih dari 0");
  });

  it("falls back to zod's default message for the case it does not name", () => {
    const onlyRequired = z.string({ error: typeErrors({ required: "Catatan wajib diisi" }) });
    expect(firstMessage(onlyRequired, undefined)).toBe("Catatan wajib diisi");
    expect(firstMessage(onlyRequired, 5)).toBe(firstMessage(z.string(), 5));
  });
});
