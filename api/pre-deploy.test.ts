import { describe, it, expect } from "vitest";
import { selectBaselineInserts } from "../scripts/pre-deploy";

// Mirrors db/migrations/meta/_journal.json: the two initial-snapshot migrations
// generated from the schema the old runtime ensureSchema already created.
const ENTRIES = [
  {
    idx: 0,
    version: "5",
    when: 1786619859456,
    tag: "0000_black_white_queen",
    breakpoints: true,
  },
  {
    idx: 1,
    version: "5",
    when: 1786620550537,
    tag: "0001_parched_spectrum",
    breakpoints: true,
  },
];
const THROUGH = "0001_parched_spectrum";

describe("selectBaselineInserts", () => {
  it("baselines the whole initial snapshot on a fresh (unrecorded) database", () => {
    const out = selectBaselineInserts(ENTRIES, THROUGH, new Set());
    expect(out.map(e => e.tag)).toEqual([
      "0000_black_white_queen",
      "0001_parched_spectrum",
    ]);
  });

  it("repairs a partial journal left by a failed deploy (only 0000 recorded)", () => {
    // The exact poisoned state that made the deploy fail twice: the migrations
    // table exists with only 0000, so 0001 must still be baselined — otherwise
    // the runner re-runs 0001's CREATE INDEX statements against a live schema.
    const recorded = new Set(["1786619859456"]);
    const out = selectBaselineInserts(ENTRIES, THROUGH, recorded);
    expect(out.map(e => e.tag)).toEqual(["0001_parched_spectrum"]);
  });

  it("is a no-op once the snapshot is fully baselined", () => {
    const recorded = new Set(["1786619859456", "1786620550537"]);
    expect(selectBaselineInserts(ENTRIES, THROUGH, recorded)).toEqual([]);
  });

  it("never baselines migrations after the through-tag (future changes must run)", () => {
    const withFuture = [
      ...ENTRIES,
      {
        idx: 2,
        version: "5",
        when: 1799999999999,
        tag: "0002_new_feature",
        breakpoints: true,
      },
    ];
    const out = selectBaselineInserts(withFuture, THROUGH, new Set());
    expect(out.map(e => e.tag)).not.toContain("0002_new_feature");
    expect(out.map(e => e.tag)).toEqual([
      "0000_black_white_queen",
      "0001_parched_spectrum",
    ]);
  });

  it("throws when the through-tag is missing so a misconfig fails loudly", () => {
    expect(() =>
      selectBaselineInserts(ENTRIES, "9999_nope", new Set())
    ).toThrow(/not found in migration journal/);
  });

  it("throws on an empty journal", () => {
    expect(() => selectBaselineInserts([], THROUGH, new Set())).toThrow(
      /No migrations found/
    );
  });
});
