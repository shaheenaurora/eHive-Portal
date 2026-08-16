import { describe, it, expect } from "vitest";
import { seatToChapterRole } from "@contracts/constants";

describe("seatToChapterRole", () => {
  it("maps the common named seats to their role keys", () => {
    expect(seatToChapterRole("President").role).toBe("president");
    expect(seatToChapterRole("Treasurer").role).toBe("treasurer");
    expect(seatToChapterRole("Secretary").role).toBe("secretary");
    expect(seatToChapterRole("VP Membership").role).toBe("vp_membership");
  });

  it("is case- and punctuation-insensitive", () => {
    expect(seatToChapterRole("  president  ").role).toBe("president");
    expect(seatToChapterRole("VP  Programming").role).toBe("vp_programming");
    expect(seatToChapterRole("vp-communications").role).toBe(
      "vp_communications"
    );
  });

  it("resolves President-Elect to Vice President, not President", () => {
    expect(seatToChapterRole("President-Elect").role).toBe("vice_president");
    expect(seatToChapterRole("Vice President").role).toBe("vice_president");
  });

  it("matches the full role label", () => {
    expect(seatToChapterRole("Immediate Past President").role).toBe(
      "past_president"
    );
    expect(seatToChapterRole("Member Experience Officer").role).toBe(
      "member_experience"
    );
  });

  it("falls back to the generic role with the seat as its title", () => {
    const r = seatToChapterRole("Sergeant-at-Arms");
    expect(r.role).toBe("other");
    expect(r.title).toBe("Sergeant-at-Arms");
  });

  it("named seats carry no custom title (they use the role default)", () => {
    expect(seatToChapterRole("President").title).toBeNull();
  });

  it("handles an empty seat without throwing", () => {
    const r = seatToChapterRole("   ");
    expect(r.role).toBe("other");
    expect(r.title).toBe("Officer");
  });
});
