import { describe, it, expect } from "vitest";
import { signBookingToken, verifyBookingToken } from "./booking-token";

describe("booking manage tokens", () => {
  it("round-trips for the right appointment", () => {
    const token = signBookingToken(42, Date.now() + 60_000);
    expect(verifyBookingToken(token, 42)).toBe(true);
  });

  it("rejects a token for a different appointment", () => {
    const token = signBookingToken(42, Date.now() + 60_000);
    expect(verifyBookingToken(token, 43)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const token = signBookingToken(42, Date.now() + 60_000);
    const parts = token.split(".");
    parts[2] = parts[2].slice(0, -2) + "xx";
    expect(verifyBookingToken(parts.join("."), 42)).toBe(false);
  });

  it("rejects tampered appointment id", () => {
    const token = signBookingToken(42, Date.now() + 60_000);
    const parts = token.split(".");
    parts[0] = "43";
    expect(verifyBookingToken(parts.join("."), 43)).toBe(false);
  });

  it("rejects expired tokens", () => {
    const token = signBookingToken(42, Date.now() - 1_000);
    expect(verifyBookingToken(token, 42)).toBe(false);
  });

  it("rejects malformed tokens", () => {
    expect(verifyBookingToken("", 42)).toBe(false);
    expect(verifyBookingToken("abc.def", 42)).toBe(false);
    expect(verifyBookingToken("1.2.3.4.5", 42)).toBe(false);
  });
});
