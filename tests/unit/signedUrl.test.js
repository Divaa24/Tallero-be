import { describe, it, expect } from "vitest";
import { createSignedUrl, verifySignedUrl } from "../../src/utils/signedUrl.js";

describe("Unit: utils/signedUrl.js", () => {
  it("membuat dan memverifikasi signed URL yang valid selama belum kedaluwarsa", () => {
    const fixedNow = 1_700_000_000_000;
    const { exp, sig, url } = createSignedUrl({
      kind: "avatar",
      id: "550e8400-e29b-41d4-a716-446655440000",
      ttlSec: 600,
      nowMs: fixedNow,
    });

    expect(url).toContain("/api/v1/files/avatar/550e8400-e29b-41d4-a716-446655440000");

    const check = verifySignedUrl({
      kind: "avatar",
      id: "550e8400-e29b-41d4-a716-446655440000",
      exp,
      sig,
      nowMs: fixedNow + 599_000,
    });
    expect(check).toEqual({ valid: true, exp });
  });

  it("menolak signed URL yang sudah kedaluwarsa (EXPIRED)", () => {
    const fixedNow = 1_700_000_000_000;
    const { exp, sig } = createSignedUrl({
      kind: "booking-photo",
      id: "123",
      ttlSec: 60,
      nowMs: fixedNow,
    });

    const check = verifySignedUrl({
      kind: "booking-photo",
      id: "123",
      exp,
      sig,
      nowMs: fixedNow + 60_000,
    });
    expect(check).toEqual({ valid: false, reason: "EXPIRED" });
  });

  it("menolak signed URL yang dimodifikasi (tampered signature, id, atau exp)", () => {
    const fixedNow = 1_700_000_000_000;
    const { exp, sig } = createSignedUrl({
      kind: "avatar",
      id: "42",
      ttlSec: 600,
      nowMs: fixedNow,
    });

    expect(
      verifySignedUrl({
        kind: "avatar",
        id: "42",
        exp,
        sig: `${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`,
        nowMs: fixedNow,
      })
    ).toEqual({ valid: false, reason: "INVALID_SIGNATURE" });

    expect(verifySignedUrl({ kind: "avatar", id: "43", exp, sig, nowMs: fixedNow })).toEqual({
      valid: false,
      reason: "INVALID_SIGNATURE",
    });

    expect(
      verifySignedUrl({ kind: "avatar", id: "42", exp: exp + 100, sig, nowMs: fixedNow })
    ).toEqual({ valid: false, reason: "INVALID_SIGNATURE" });
  });

  it("mencegah path traversal pada parameter kind/id", () => {
    expect(() => createSignedUrl({ kind: "../etc", id: "passwd" })).toThrow(TypeError);
    expect(
      verifySignedUrl({ kind: "avatar", id: "../secret", exp: 1_800_000_000, sig: "abc" })
    ).toEqual({ valid: false, reason: "INVALID_PARAMS" });
  });
});
