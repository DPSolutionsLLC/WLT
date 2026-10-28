import {
  createMember,
  createTestUser,
  createZoomInvitee,
  createZoomJoinLink,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// ZOOM LINK POOL, HAND-OUT AND INVITEES (ITER-053, migration 095).
//
// Zoom is released (the harness ward has no release list). Three placeholder links, oldest first:
//   * Guest 01 — GIVEN to Grace Holt (a roster member) by the bishop
//   * Guest 02 — free
//   * Guest 03 — free
// so two hand-outs empty the pool and the third person is saved as waiting.
//
// Roster: Thomas Reed (active, phone on file) to pick, and Lena Ortiz, MOVED OUT, who must not
// appear in the picker.
export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();

  const bishop = await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  await createTestUser({
    handle: "counselor1",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 1,
    firstName: "Dana",
    lastName: "Whitmore",
  });

  await createTestUser({
    handle: "counselor2",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 2,
    firstName: "Owen",
    lastName: "Pryce",
  });

  await createTestUser({
    handle: "clerk",
    role: "ward_secretary",
    firstName: "Sarah",
    lastName: "Brooks",
  });

  await createTestUser({
    handle: "execsec",
    role: "executive_secretary",
    firstName: "Paul",
    lastName: "Nguyen",
  });

  await createTestUser({
    handle: "eqpresident",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  const grace = await createMember({ firstName: "Grace", lastName: "Holt", phone: "555-201-3344" });
  await createMember({ firstName: "Thomas", lastName: "Reed", phone: "555-201-7788" });
  await createMember({ firstName: "Lena", lastName: "Ortiz", status: "moved_out" });

  const base = Date.now() - 60 * 60 * 1000;
  const guest01 = await createZoomJoinLink({
    placeholderName: "Guest 01",
    placeholderEmail: "sacrament+guest01@example.org",
    joinUrl: "https://example.org/j/guest01",
    createdBy: bishop.id,
    createdAt: new Date(base).toISOString(),
  });
  await createZoomJoinLink({
    placeholderName: "Guest 02",
    placeholderEmail: "sacrament+guest02@example.org",
    joinUrl: "https://example.org/j/guest02",
    createdBy: bishop.id,
    createdAt: new Date(base + 1000).toISOString(),
  });
  await createZoomJoinLink({
    placeholderName: "Guest 03",
    placeholderEmail: "sacrament+guest03@example.org",
    joinUrl: "https://example.org/j/guest03",
    createdBy: bishop.id,
    createdAt: new Date(base + 2000).toISOString(),
  });

  await createZoomInvitee({
    displayName: "Grace Holt",
    memberId: grace,
    phone: "555-201-3344",
    assignedBy: bishop.id,
    joinLinkId: guest01,
  });
}
