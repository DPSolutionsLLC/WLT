import {
  createTestUser,
  createZoomRemoteLink,
  ensureTestWard,
  releaseTestCalling,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// ZOOM REMOTE LINKS (ITER-051, migration 094).
//
// Zoom is released (the harness ward has no release list, which means everything). Four of the
// five positions are held; the executive secretary's is VACANT, so the tab can show "No one
// called" with no Paste button.
//
// Each link is in a different state, so one visit to the Remote links tab shows every row type:
//   * Bishop        — live, opening https://example.org/?remote=bishop
//   * 1st Counselor — live, opening https://example.org/?remote=counselor_1
//   * 2nd Counselor — needs a new link: bound to Ruth Hallam's RELEASED calling, stamped
//                     holder_changed, so it reads "the last one was for Ruth Hallam"
//   * Ward Clerk    — no row at all
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

  const firstCounselor = await createTestUser({
    handle: "counselor1",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 1,
    firstName: "Dana",
    lastName: "Whitmore",
  });

  // The former 2nd counselor. Created first, given the link, then released.
  const former = await createTestUser({
    handle: "former",
    role: "counselor",
    org: "bishopric",
    counselorPosition: 2,
    firstName: "Ruth",
    lastName: "Hallam",
  });
  await createZoomRemoteLink({
    position: "counselor_2",
    holderUserId: former.id,
    setBy: bishop.id,
    deactivatedReason: "holder_changed",
  });
  await releaseTestCalling(former.id);

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
    handle: "eqpresident",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  await createZoomRemoteLink({ position: "bishop", holderUserId: bishop.id, setBy: bishop.id });
  await createZoomRemoteLink({
    position: "counselor_1",
    holderUserId: firstCounselor.id,
    setBy: bishop.id,
  });
}
