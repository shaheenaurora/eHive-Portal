import { describe, it, expect } from "vitest";
import {
  awardCategoryByKey,
  nominationWindowState,
  validateNomineeForCategory,
} from "@contracts/awards";

describe("awardCategoryByKey", () => {
  it("resolves a real category with its subject", () => {
    expect(awardCategoryByKey("chapter_of_year")?.subject).toBe("chapter");
    expect(awardCategoryByKey("member_of_year")?.subject).toBe("member");
  });
  it("returns null for an unknown key", () => {
    expect(awardCategoryByKey("not_a_category")).toBeNull();
  });
});

describe("nominationWindowState", () => {
  const open = new Date("2026-06-01T00:00:00Z");
  const close = new Date("2026-06-30T00:00:00Z");
  it("is 'before' ahead of the open date", () => {
    expect(
      nominationWindowState(open, close, new Date("2026-05-15T00:00:00Z"))
    ).toBe("before");
  });
  it("is 'open' within the window", () => {
    expect(
      nominationWindowState(open, close, new Date("2026-06-15T00:00:00Z"))
    ).toBe("open");
  });
  it("is 'after' past the close date", () => {
    expect(
      nominationWindowState(open, close, new Date("2026-07-15T00:00:00Z"))
    ).toBe("after");
  });
  it("treats missing bounds as unbounded on that side", () => {
    expect(nominationWindowState(null, null, new Date())).toBe("open");
    expect(
      nominationWindowState(null, close, new Date("2026-07-15T00:00:00Z"))
    ).toBe("after");
  });
});

describe("validateNomineeForCategory", () => {
  it("rejects an unknown category", () => {
    expect(validateNomineeForCategory("nope", { nomineeMemberId: 1 }).ok).toBe(
      false
    );
  });
  it("requires a nominee", () => {
    expect(validateNomineeForCategory("member_of_year", {}).ok).toBe(false);
  });
  it("rejects both a member and a chapter at once", () => {
    expect(
      validateNomineeForCategory("member_of_year", {
        nomineeMemberId: 1,
        nomineeChapterId: 2,
      }).ok
    ).toBe(false);
  });
  it("blocks a member nominee for a chapter category and vice-versa", () => {
    expect(
      validateNomineeForCategory("chapter_of_year", { nomineeMemberId: 1 }).ok
    ).toBe(false);
    expect(
      validateNomineeForCategory("member_of_year", { nomineeChapterId: 2 }).ok
    ).toBe(false);
  });
  it("accepts a correctly-typed nominee", () => {
    expect(
      validateNomineeForCategory("member_of_year", { nomineeMemberId: 1 }).ok
    ).toBe(true);
    expect(
      validateNomineeForCategory("chapter_of_year", { nomineeChapterId: 2 }).ok
    ).toBe(true);
  });
});
