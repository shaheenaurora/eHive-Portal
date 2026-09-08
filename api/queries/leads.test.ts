import { describe, it, expect } from "vitest";
import { leadProduct } from "./leads";

describe("leadProduct attribution", () => {
  it("uses the scorecard recommendation for scorecard leads", () => {
    expect(
      leadProduct(
        { form: "clarity-scorecard", payload: "{}" },
        "Clarity Sprint"
      )
    ).toBe("Clarity Sprint");
  });

  it("maps brand-check leads to Brand 3D", () => {
    expect(leadProduct({ form: "brand-check", payload: "{}" }, null)).toBe(
      "Brand 3D"
    );
  });

  it("uses the payload product for bookings", () => {
    expect(
      leadProduct(
        { form: "booking", payload: JSON.stringify({ product: "discovery" }) },
        null
      )
    ).toBe("discovery");
  });

  it("falls back to the form name", () => {
    expect(leadProduct({ form: "partner-enquiry", payload: "{}" }, null)).toBe(
      "partner-enquiry"
    );
    expect(leadProduct({ form: "booking", payload: "not-json" }, null)).toBe(
      "booking"
    );
  });
});
