// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createReferralCode,
  createStatusToken,
  hashStatusToken,
  registrationPageUrl,
  statusPagePath,
  statusPageUrl,
} from "@/lib/zoom/registrationTokens";

// The Zoom sign-up's status token and referral code (ITER-052, plan P6).

describe("createStatusToken", () => {
  it("is 43 base64url characters — the shape migration 096's status function accepts", () => {
    const { token } = createStatusToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("stores the SHA-256 of the token, never the token", () => {
    const { token, hash } = createStatusToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashStatusToken(token));
    expect(hash).not.toContain(token);
  });

  it("never repeats", () => {
    expect(createStatusToken().token).not.toBe(createStatusToken().token);
  });
});

describe("hashStatusToken", () => {
  // That the SQL digest agrees is proved in tests/rls/zoom-registration-functions.test.ts, where a
  // status page is found by a token this module hashed.
  it("matches a known SHA-256", () => {
    expect(hashStatusToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("createReferralCode", () => {
  it("is ten letters and digits", () => {
    for (let index = 0; index < 20; index += 1) {
      expect(createReferralCode()).toMatch(/^[A-Za-z0-9]{10}$/);
    }
  });
});

describe("the page URLs", () => {
  it("builds the status page under the sign-up page's slug", () => {
    expect(statusPagePath("zoom-abc", "tok")).toBe("/public/zoom-abc/status/tok");
    expect(statusPageUrl("https://ward.example", "zoom-abc", "tok")).toBe(
      "https://ward.example/public/zoom-abc/status/tok",
    );
  });

  it("adds the referral code to a shared sign-up link", () => {
    expect(registrationPageUrl("https://ward.example", "zoom-abc", "AbCdE12345")).toBe(
      "https://ward.example/public/zoom-abc?ref=AbCdE12345",
    );
    expect(registrationPageUrl("https://ward.example", "zoom-abc")).toBe(
      "https://ward.example/public/zoom-abc",
    );
  });

  it("returns null with no site URL, rather than a localhost address", () => {
    expect(statusPageUrl(null, "zoom-abc", "tok")).toBeNull();
    expect(registrationPageUrl(null, "zoom-abc", "AbCdE12345")).toBeNull();
  });
});
