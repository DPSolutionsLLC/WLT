import {
  createMember,
  createPublicPage,
  createTestUser,
  createTodo,
  createZoomJoinLink,
  createZoomRegistration,
  createZoomRegistrationResponse,
  createZoomRegistrationSettings,
  ensureTestWard,
  seedNotificationTriggers,
  testStatusToken,
} from "../../../infrastructure/seedUtils.ts";

// ZOOM SIGN-UPS — BISHOPRIC APPROVAL AND ROSTER MATCHING (ITER-052 z3b, migrations 096 and 098).
//
// Sign-ups are OPEN and APPROVALS ARE ON, so every request waits for the bishop and both
// counselors. ONE free placeholder link, so the first approval takes it and the next waits.
//
// Four pending sign-ups:
//   * Alex Turner   — the bishop has approved; the counselors have not answered
//   * Jordan Blake  — the bishop and the 2nd counselor approved; the 1st counselor wants to talk first
//   * Sam Fielding  — says "I'm a member"; a match to-do on all three bishopric lists, and a roster
//                     member of the same name to match to
//   * Casey Morrow  — nobody has answered; used for "Not this time"
//
// Each person's status page is /public/zoom-harness098signup/status/<testStatusToken(name)>; the
// seed prints the four links.
const SLUG = "zoom-harness098signup";

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
  const counselor1 = await createTestUser({
    handle: "counselor1",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 1,
    firstName: "Dana",
    lastName: "Whitmore",
  });
  const counselor2 = await createTestUser({
    handle: "counselor2",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 2,
    firstName: "Owen",
    lastName: "Pryce",
  });
  await createTestUser({ handle: "clerk", role: "ward_secretary", firstName: "Sarah", lastName: "Brooks" });

  await createMember({ firstName: "Sam", lastName: "Fielding", phone: "555-402-3333" });
  await createMember({ firstName: "Samantha", lastName: "Fielding", phone: "555-402-3334" });

  await createPublicPage({ pageType: "zoom_registration", slug: SLUG });
  await createZoomRegistrationSettings({ isOpen: true, autoApprove: false, emailBishopricOnNew: true });

  await createZoomJoinLink({
    placeholderName: "Guest 01",
    placeholderEmail: "sacrament+guest01@example.org",
    joinUrl: "https://example.org/j/guest01",
    createdBy: bishop.id,
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const day = 24 * 60 * 60 * 1000;
  const base = Date.now() - 2 * day;

  const alex = await createZoomRegistration({
    displayName: "Alex Turner",
    phone: "555-402-1111",
    email: "alex@example.org",
    saysMember: false,
    referralCode: "AlexRef001",
    createdAt: new Date(base).toISOString(),
  });
  await createZoomRegistrationResponse({ registrationId: alex, userId: bishop.id, response: "approve" });

  const jordan = await createZoomRegistration({
    displayName: "Jordan Blake",
    phone: "555-402-2222",
    saysMember: false,
    referralCode: "JordRef002",
    createdAt: new Date(base + 60_000).toISOString(),
  });
  await createZoomRegistrationResponse({ registrationId: jordan, userId: bishop.id, response: "approve" });
  await createZoomRegistrationResponse({ registrationId: jordan, userId: counselor2.id, response: "approve" });
  await createZoomRegistrationResponse({
    registrationId: jordan,
    userId: counselor1.id,
    response: "talk_first",
  });

  const sam = await createZoomRegistration({
    displayName: "Sam Fielding",
    phone: "555-402-3333",
    saysMember: true,
    referralCode: "SamRef0003",
    createdAt: new Date(base + day).toISOString(),
  });
  for (const owner of [bishop, counselor1, counselor2]) {
    await createTodo({
      userId: owner.id,
      title: "Match Sam Fielding to the roster",
      tag: "Zoom",
      zoomRegistrationId: sam,
    });
  }

  await createZoomRegistration({
    displayName: "Casey Morrow",
    phone: "555-402-4444",
    saysMember: false,
    referralCode: "CaseyRef04",
    createdAt: new Date(base + day + 60_000).toISOString(),
  });

  for (const name of ["Alex Turner", "Jordan Blake", "Sam Fielding", "Casey Morrow"]) {
    console.log(`  ${name}: /public/${SLUG}/status/${testStatusToken(name)}`);
  }
}
