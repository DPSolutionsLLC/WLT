import type { ZoomRegistrationHeldReason } from "@/types/domain";

// WHAT HAPPENS TO A NEW ZOOM SIGN-UP (ITER-052, plan P7). Pure, so every branch is tested without
// a database.
//
// The pool of join links is the scarce thing, and these protect it without storing an IP address
// (personal data) or adding a secret:
//   - a ward-wide cap of 40 sign-ups per rolling 24 hours — beyond it the request is refused;
//   - an auto-approve cap of 10 per rolling 24 hours — beyond it the request waits for a person;
//   - a phone number seen before is never approved automatically.
// Rolling windows avoid any time-zone arithmetic (CLAUDE.md rule 12).
//
// THE ORDER IS THE RULE: busy beats everything, then approvals-on, then same phone, then the
// auto-approve cap. So with approvals on, a repeat phone is held as `approvals_on` — the card still
// shows "Same phone as an earlier request", which is computed on read rather than stored.

export const WARD_DAILY_REGISTRATION_LIMIT = 40;
export const AUTO_APPROVE_DAILY_LIMIT = 10;
export const REGISTRATION_WINDOW_HOURS = 24;

export type IntakeDecision =
  | { kind: "refuse_busy" }
  | { kind: "pending"; heldReason: ZoomRegistrationHeldReason }
  | { kind: "auto_approve" };

export function decideIntake(params: {
  recentCount: number;
  recentAutoApprovedCount: number;
  autoApprove: boolean;
  samePhoneExists: boolean;
}): IntakeDecision {
  if (params.recentCount >= WARD_DAILY_REGISTRATION_LIMIT) return { kind: "refuse_busy" };
  if (!params.autoApprove) return { kind: "pending", heldReason: "approvals_on" };
  if (params.samePhoneExists) return { kind: "pending", heldReason: "same_phone" };
  if (params.recentAutoApprovedCount >= AUTO_APPROVE_DAILY_LIMIT) {
    return { kind: "pending", heldReason: "daily_limit" };
  }
  return { kind: "auto_approve" };
}

export function windowStart(now: Date): string {
  return new Date(now.getTime() - REGISTRATION_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
}
