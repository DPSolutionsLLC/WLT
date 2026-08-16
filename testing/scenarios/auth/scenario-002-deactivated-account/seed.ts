import { createTestUser, ensureTestWard } from "../../../infrastructure/seedUtils.ts";

// `formerclerk` is created already deactivated. Reaching that state by hand means signing in,
// signing out, and editing a row in the dashboard between the two — which is exactly the kind
// of setup that gets skipped.
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
    isActive: true,
  });

  await createTestUser({
    handle: "formerclerk",
    role: "ward_secretary",
    org: "bishopric",
    firstName: "Grant",
    lastName: "Holloway",
    isActive: false,
  });

  console.log("  ward, 2 users (bishop active, formerclerk deactivated)");
}
