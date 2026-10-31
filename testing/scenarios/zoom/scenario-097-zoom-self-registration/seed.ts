import {
  createPublicPage,
  createTestUser,
  createZoomInvitee,
  createZoomJoinLink,
  createZoomRegistration,
  createZoomRegistrationQuestion,
  createZoomRegistrationSettings,
  ensureTestWard,
  seedNotificationTriggers,
  testStatusToken,
} from "../../../infrastructure/seedUtils.ts";

// ZOOM SIGN-UPS — THE PUBLIC PAGE AND AUTO-APPROVE (ITER-052 z3a, migration 096).
//
// Zoom is released (the harness ward has no release list). Sign-ups are OPEN and approve
// AUTOMATICALLY. Three placeholder links, oldest first:
//   * Guest 01 — given to Riley Approved (a self-registered invitee)
//   * Guest 02, Guest 03 — free, so two new sign-ups empty the pool and a third waits
//
// Four existing sign-ups:
//   * Riley Approved — approved, holds Guest 01
//   * Riley Again    — pending, held: same phone as Riley Approved
//   * Dana Declined  — declined
//   * Kim Referred   — pending, held: daily limit, referred by Riley Approved
//
// Each seeded person's status page is /public/zoom-harness097signup/status/<token>, where the
// token is testStatusToken(<their name>); the seed prints the four links.
const SLUG = "zoom-harness097signup";

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
  await createTestUser({ handle: "clerk", role: "ward_secretary", firstName: "Sarah", lastName: "Brooks" });
  await createTestUser({ handle: "execsec", role: "executive_secretary", firstName: "Paul", lastName: "Nguyen" });
  await createTestUser({
    handle: "eqpresident",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  await createPublicPage({ pageType: "zoom_registration", slug: SLUG });
  await createZoomRegistrationSettings({ isOpen: true, autoApprove: true, emailBishopricOnNew: true });

  const missionaries = await createZoomRegistrationQuestion({
    prompt: "Would you welcome a visit from the missionaries?",
    kind: "yes_no",
    audience: "non_members",
    position: 1,
  });
  const address = await createZoomRegistrationQuestion({
    prompt: "What's your address?",
    kind: "short_text",
    audience: "non_members",
    position: 2,
    isRequired: true,
    shownWhenYesTo: missionaries,
  });
  const heard = await createZoomRegistrationQuestion({
    prompt: "How did you hear about us?",
    kind: "short_text",
    audience: "everyone",
    position: 3,
  });
  await createZoomRegistrationQuestion({
    prompt: "Would you like a printed programme posted to you?",
    kind: "yes_no",
    audience: "everyone",
    position: 4,
    isActive: false,
  });

  const base = Date.now() - 2 * 24 * 60 * 60 * 1000;
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

  const rileyInvitee = await createZoomInvitee({
    displayName: "Riley Approved",
    phone: "555-301-1111",
    source: "self_registration",
    joinLinkId: guest01,
  });

  const riley = await createZoomRegistration({
    displayName: "Riley Approved",
    phone: "555-301-1111",
    saysMember: false,
    status: "approved",
    inviteeId: rileyInvitee,
    referralCode: "RileyRef01",
    answers: [
      { questionId: missionaries, prompt: "Would you welcome a visit from the missionaries?", kind: "yes_no", answer: true },
      { questionId: address, prompt: "What's your address?", kind: "short_text", answer: "48 Orchard Lane" },
      { questionId: heard, prompt: "How did you hear about us?", kind: "short_text", answer: "A neighbour" },
    ],
    createdAt: new Date(base + 60_000).toISOString(),
  });

  await createZoomRegistration({
    displayName: "Riley Again",
    phone: "(555) 301-1111",
    saysMember: false,
    heldReason: "same_phone",
    referralCode: "RileyRef02",
    createdAt: new Date(base + 24 * 60 * 60 * 1000).toISOString(),
  });

  await createZoomRegistration({
    displayName: "Dana Declined",
    phone: "555-301-3333",
    saysMember: true,
    status: "declined",
    decidedBy: bishop.id,
    declineNote: "Spoke with them after church.",
    referralCode: "DanaRef003",
    createdAt: new Date(base + 2 * 60_000).toISOString(),
  });

  await createZoomRegistration({
    displayName: "Kim Referred",
    phone: "555-301-4444",
    email: "kim@example.org",
    saysMember: false,
    heldReason: "daily_limit",
    referralCode: "KimRef0004",
    referredByRegistrationId: riley,
    createdAt: new Date(base + 24 * 60 * 60 * 1000 + 60_000).toISOString(),
  });

  for (const name of ["Riley Approved", "Riley Again", "Dana Declined", "Kim Referred"]) {
    console.log(`  ${name}: /public/${SLUG}/status/${testStatusToken(name)}`);
  }
}
