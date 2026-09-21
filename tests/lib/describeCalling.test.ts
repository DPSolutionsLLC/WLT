import { describe, expect, it } from "vitest";
import {
  ORG_SCOPED_ROLE_SUFFIXES,
  ROLES,
  ROLE_LABELS,
  describeCalling,
} from "@/types/domain";

// The walk of scenario 066 found the app's persistent header saying "Organization President",
// which names the role and not the organization. The user confirmed on 2026-09-21 that it must
// name the organization.
//
// It matters more under the calling model than it did before: somebody may hold an org calling in
// one ward and a different calling in another, so this line is what tells them which of their
// callings is active. "Organization President" answers that only halfway.

describe("describeCalling", () => {
  it("names the organization for an org-scoped calling", () => {
    expect(describeCalling("org_president", "Relief Society")).toBe(
      "Relief Society President",
    );
    expect(describeCalling("org_counselor", "Elders Quorum")).toBe(
      "Elders Quorum Counselor",
    );
    expect(describeCalling("org_secretary", "Primary")).toBe("Primary Secretary");
  });

  // A bishop or a ward secretary has no organization, and "Harness Second Ward Ward Secretary"
  // would be worse than the plain label rather than better.
  it("leaves a calling with no organization alone", () => {
    expect(describeCalling("bishop", null)).toBe("Bishop");
    expect(describeCalling("ward_secretary", null)).toBe("Ward Secretary");
  });

  // An organization name attached to a role that is not org-scoped must be IGNORED, not appended.
  // current_org_id() is null for these callings today, but a future caller passing a stale value
  // must not be able to rename the bishop.
  it("ignores an organization name on a role that is not org-scoped", () => {
    expect(describeCalling("bishop", "Relief Society")).toBe("Bishop");
    expect(describeCalling("executive_secretary", "Primary")).toBe("Executive Secretary");
  });

  // THE DEGRADED PATH, and it is deliberate. A failed organization read falls back to the generic
  // label rather than to a blank or a raw id: this is chrome on every page in the app, and
  // "Organization President" is worse than the specific name and much better than nothing.
  it("falls back to the plain role label when the organization name is unknown", () => {
    expect(describeCalling("org_president", null)).toBe(ROLE_LABELS.org_president);
    expect(describeCalling("org_president", "")).toBe(ROLE_LABELS.org_president);
  });

  // THE DRIFT GUARD. ORG_SCOPED_ROLE_SUFFIXES is a full Record so a new role fails to compile
  // until somebody decides whether it is org-scoped — the rule ROLE_LABELS states for itself and
  // `role-access-overrides` states for the permission matrix. This asserts the two lists stay the
  // same shape, which the compiler alone cannot do once a role is added to only one of them.
  it("covers every role, so a new one forces a decision", () => {
    expect(Object.keys(ORG_SCOPED_ROLE_SUFFIXES).sort()).toEqual([...ROLES].sort());
    expect(Object.keys(ROLE_LABELS).sort()).toEqual([...ROLES].sort());
  });

  // Every role must produce a non-empty label whatever it is handed. The header has no empty
  // state, so a role that rendered as "" would read as a broken page rather than a missing name.
  it("never renders an empty label for any role", () => {
    for (const role of ROLES) {
      expect(describeCalling(role, null)).toBeTruthy();
      expect(describeCalling(role, "Elders Quorum")).toBeTruthy();
    }
  });
});
