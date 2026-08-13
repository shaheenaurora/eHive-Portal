import { describe, it, expect } from "vitest";
import { maskIdNumber } from "@contracts/constants";

describe("maskIdNumber", () => {
  it("shows only the last 4 characters", () => {
    expect(maskIdNumber("784199012345678")).toBe("•••••••••••5678");
  });
  it("masks a short id entirely", () => {
    expect(maskIdNumber("12")).toBe("••");
    expect(maskIdNumber("1234")).toBe("••••");
  });
  it("is empty for empty/nullish input", () => {
    expect(maskIdNumber("")).toBe("");
    expect(maskIdNumber(null)).toBe("");
    expect(maskIdNumber(undefined)).toBe("");
  });
});
