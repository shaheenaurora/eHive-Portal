import { describe, it, expect } from "vitest";
import { refCode, parseRefCode, ID_PREFIX } from "@contracts/ids";

describe("refCode", () => {
  it("formats each entity with its prefix and padding", () => {
    expect(refCode("member", 19)).toBe("EH-M-00019");
    expect(refCode("chapter", 3)).toBe("EH-CH-0003");
    expect(refCode("zone", 2)).toBe("EH-ZN-002");
    expect(refCode("region", 1)).toBe("EH-RG-001");
    expect(refCode("country", 1)).toBe("EH-CO-001");
    expect(refCode("event", 21)).toBe("EH-EV-00021");
    expect(refCode("pod", 7)).toBe("EH-PD-0007");
    expect(refCode("payment", 1234)).toBe("EH-INV-01234");
  });
  it("never emits a negative id", () => {
    expect(refCode("member", -5)).toBe("EH-M-00000");
  });
});

describe("parseRefCode", () => {
  it("round-trips every entity type", () => {
    for (const type of Object.keys(ID_PREFIX) as (keyof typeof ID_PREFIX)[]) {
      const code = refCode(type, 42);
      expect(parseRefCode(code)).toEqual({ type, id: 42 });
    }
  });
  it("is case- and whitespace-insensitive", () => {
    expect(parseRefCode("  eh-ch-0003 ")).toEqual({ type: "chapter", id: 3 });
  });
  it("returns null for unknown or malformed codes", () => {
    expect(parseRefCode("XX-9-1")).toBeNull();
    expect(parseRefCode("EH-ZZ-0001")).toBeNull();
    expect(parseRefCode("not a code")).toBeNull();
  });
});
