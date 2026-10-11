import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("lets later Tailwind classes override conflicting earlier ones", () => {
    expect(cn("rounded-lg px-4 text-sm", "rounded-full px-7")).toBe("text-sm rounded-full px-7");
    expect(cn("bg-surface", "dark:bg-brand-600", "bg-amber-50/40")).toBe("dark:bg-brand-600 bg-amber-50/40");
  });

  it("returns empty string for no inputs", () => {
    expect(cn()).toBe("");
  });
});
