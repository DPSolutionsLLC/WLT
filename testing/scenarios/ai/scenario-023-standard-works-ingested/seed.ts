import {
  createTestUser,
  ensureTestWard,
  seedNotificationTriggers,
} from "../../../infrastructure/seedUtils.ts";

// A ward and a bishop, and DELIBERATELY NOTHING ELSE.
//
// The whole point of this scenario is that the SCRIPT fills the knowledge base. Seeding
// documents here would mean the tester could not tell what the script did from what the seed
// did, and the idempotency check — "run it twice, and the second run must refuse" — would be
// testing the seed rather than the script.
//
// The corpus itself is a fixture in this folder rather than a seeded row, because the script
// reads a FILE. See fixtures/sample-corpus.json.
//
// The bishop exists so /knowledge can be opened afterwards to confirm the volumes arrived with
// matching counts — the script writes with the service-role client and no session, so nothing
// about the ingest itself needs a signed-in user.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });
  await seedNotificationTriggers();

  await createTestUser({
    handle: "bishop",
    role: "bishop",
    org: "bishopric",
    firstName: "Mark",
    lastName: "Andersen",
  });

  console.log("  ward, 1 user, no documents — the script fills the knowledge base");
}
