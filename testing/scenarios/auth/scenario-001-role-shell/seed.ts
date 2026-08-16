import { createTestUser, ensureTestWard } from "../../../infrastructure/seedUtils.ts";

// Five accounts that differ only by role — that is the whole point. Comparing sidebars is
// only meaningful if nothing else about the users varies.
//
// Every row lives in the harness test ward, which `npm run seed:clean` deletes whole.

export async function seed(): Promise<void> {
  await ensureTestWard({ name: "Harness Test Ward" });

  await createTestUser({
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
    firstName: "David",
    lastName: "Reyes",
  });

  await createTestUser({
    handle: "secretary",
    role: "ward_secretary",
    org: "bishopric",
    firstName: "Paul",
    lastName: "Nakamura",
  });

  await createTestUser({
    handle: "music",
    role: "music_coordinator",
    firstName: "Hannah",
    lastName: "Whitfield",
  });

  await createTestUser({
    handle: "eqpres",
    role: "org_president",
    org: "eldersQuorum",
    firstName: "Miguel",
    lastName: "Cortez",
  });

  console.log("  ward, 5 users (bishop, counselor, ward secretary, music, EQ president)");
}
