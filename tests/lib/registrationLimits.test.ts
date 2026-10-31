import { describe, expect, it } from "vitest";
import {
  AUTO_APPROVE_DAILY_LIMIT,
  decideIntake,
  WARD_DAILY_REGISTRATION_LIMIT,
  windowStart,
} from "@/lib/zoom/registrationLimits";

// What happens to a new Zoom sign-up (ITER-052, plan P7). The order of the checks IS the rule.

const QUIET = {
  recentCount: 0,
  recentAutoApprovedCount: 0,
  autoApprove: true,
  samePhoneExists: false,
};

describe("decideIntake", () => {
  it("approves automatically when nothing stands in the way", () => {
    expect(decideIntake(QUIET)).toEqual({ kind: "auto_approve" });
  });

  it("refuses once the ward has had its daily share of sign-ups", () => {
    expect(decideIntake({ ...QUIET, recentCount: WARD_DAILY_REGISTRATION_LIMIT })).toEqual({
      kind: "refuse_busy",
    });
  });

  it("lets the last sign-up under the cap through", () => {
    expect(decideIntake({ ...QUIET, recentCount: WARD_DAILY_REGISTRATION_LIMIT - 1 })).toEqual({
      kind: "auto_approve",
    });
  });

  it("puts busy ahead of everything else", () => {
    expect(
      decideIntake({
        recentCount: WARD_DAILY_REGISTRATION_LIMIT,
        recentAutoApprovedCount: AUTO_APPROVE_DAILY_LIMIT,
        autoApprove: false,
        samePhoneExists: true,
      }),
    ).toEqual({ kind: "refuse_busy" });
  });

  it("holds every request while approvals are on", () => {
    expect(decideIntake({ ...QUIET, autoApprove: false })).toEqual({
      kind: "pending",
      heldReason: "approvals_on",
    });
  });

  it("puts approvals-on ahead of a repeat phone", () => {
    expect(decideIntake({ ...QUIET, autoApprove: false, samePhoneExists: true })).toEqual({
      kind: "pending",
      heldReason: "approvals_on",
    });
  });

  it("never auto-approves a phone it has seen before", () => {
    expect(decideIntake({ ...QUIET, samePhoneExists: true })).toEqual({
      kind: "pending",
      heldReason: "same_phone",
    });
  });

  it("holds a request once the day's automatic approvals are used up", () => {
    expect(decideIntake({ ...QUIET, recentAutoApprovedCount: AUTO_APPROVE_DAILY_LIMIT })).toEqual({
      kind: "pending",
      heldReason: "daily_limit",
    });
  });

  it("puts a repeat phone ahead of the auto-approve cap", () => {
    expect(
      decideIntake({ ...QUIET, samePhoneExists: true, recentAutoApprovedCount: AUTO_APPROVE_DAILY_LIMIT }),
    ).toEqual({ kind: "pending", heldReason: "same_phone" });
  });
});

describe("windowStart", () => {
  it("is exactly 24 hours before now", () => {
    expect(windowStart(new Date("2026-10-30T12:00:00Z"))).toBe("2026-10-29T12:00:00.000Z");
  });
});
