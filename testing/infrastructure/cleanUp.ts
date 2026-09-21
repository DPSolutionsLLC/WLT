import { pathToFileURL } from "node:url";
import { describeTarget, getAdminClient } from "./adminClient.ts";
import {
  DEVELOPMENT_WARD_ID,
  TEST_EMAIL_DOMAIN,
  TEST_SECOND_WARD_ID,
  TEST_SECOND_WARD_UNIT_ID,
  TEST_STAKE_UNIT_ID,
  TEST_WARD_ID,
  TEST_WARD_UNIT_ID,
  TEST_YOUTH_EMAIL_DOMAIN,
} from "./seedUtils.ts";

// ============================================================================
// There is no emulator to wipe, and `npm run db:reset` against the linked project is a
// production wipe (CLAUDE.md §9). So cleanup is narrow by construction: it deletes exactly
// one ward by id and exactly the auth users whose email sits on the harness domain. It never
// truncates, never deletes by pattern across tables, and never touches a ward it was not
// told about at compile time.
// ============================================================================

// BOTH harness wards are checked, not only the first. Scenario 064 needs a ward the stake
// president does not belong to, so there are now two ids to delete — and a guard that checked
// one of them would be exactly as dangerous as no guard at all on the other.
const HARNESS_WARD_IDS: readonly string[] = [TEST_WARD_ID, TEST_SECOND_WARD_ID];

function assertSafeTarget(): void {
  // Widened deliberately: these are literal constants, so a direct comparison is a compile
  // error rather than a runtime guard. The check still has to exist, because the whole point
  // is to fail loudly if someone ever repoints a harness ward id at real data.
  for (const target of HARNESS_WARD_IDS) {
    if (target === DEVELOPMENT_WARD_ID) {
      throw new Error(
        "Refusing to run: a harness ward id matches the Development Ward. Cleanup would " +
          "delete the committed seed data from supabase/seed/ward.sql.",
      );
    }

    if (!/^[0-9a-f-]{36}$/i.test(target)) {
      throw new Error(`Refusing to run: "${target}" is not a well-formed ward id.`);
    }
  }

  if (new Set(HARNESS_WARD_IDS).size !== HARNESS_WARD_IDS.length) {
    throw new Error("Refusing to run: two harness ward ids are the same.");
  }
}

export type CleanUpResult = {
  wardDeleted: boolean;
  authUsersDeleted: number;
};

export async function cleanUpTestData(): Promise<CleanUpResult> {
  assertSafeTarget();

  const supabase = getAdminClient();

  // The wards go first. Every ward-scoped table cascades from `wards`, which clears the rows
  // that would otherwise block an auth-user delete through a no-action foreign key such as
  // sundays.conducting_user_id. `unit_assignments` and `ward_role_assignments` cascade from
  // `users`, which cascades from the ward, so they are cleared here too.
  //
  // ⚠️ ALL THE WARDS IN ONE STATEMENT, AND THAT IS REQUIRED SINCE MIGRATION 069 rather than tidy.
  // A person can hold a calling in the second ward while their account lives in the first, and the
  // rows they wrote over there reference them by a SINGLE-column key with no `on delete` action —
  // the composite `(author, ward_id)` key that used to make such a row impossible is gone. Ward by
  // ward, deleting the first cascades its `users` rows while the second ward's rows still point at
  // them, and Postgres refuses. One DELETE removes both sides in the same statement, and
  // referential integrity is checked once at the end of it.
  const { error: wardError } = await supabase
    .from("wards")
    .delete()
    .in("id", [...HARNESS_WARD_IDS]);

  if (wardError) {
    throw new Error(
      `Could not delete the test wards ${HARNESS_WARD_IDS.join(", ")}: ${wardError.message}`,
    );
  }

  // AND THEN THE UNITS, EXPLICITLY. `units` is deliberately ward-less (CLAUDE.md rule 1's third
  // exception) and the foreign key points the other way — wards.unit_id → units.id — so nothing
  // about deleting a ward removes its unit. Deleting the wards is what clears that reference;
  // `units.parent_id` is `on delete restrict`, which is why the two ward units must go before
  // the stake they hang off.
  const unitIdsInDeleteOrder = [
    TEST_WARD_UNIT_ID,
    TEST_SECOND_WARD_UNIT_ID,
    TEST_STAKE_UNIT_ID,
  ];

  for (const unitId of unitIdsInDeleteOrder) {
    const { error: unitError } = await supabase.from("units").delete().eq("id", unitId);

    if (unitError) {
      throw new Error(`Could not delete the test unit ${unitId}: ${unitError.message}`);
    }
  }

  const { data: listed, error: listError } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  });

  if (listError) {
    throw new Error(`Could not list auth users: ${listError.message}`);
  }

  // Both domains. Adult harness accounts sit on TEST_EMAIL_DOMAIN; youth accounts carry the
  // synthetic .invalid address keyed by the test ward id. Matching only the first left youth
  // logins working on a shared project after a "clean".
  const harnessDomains = [TEST_EMAIL_DOMAIN, TEST_YOUTH_EMAIL_DOMAIN];

  const harnessUsers = (listed?.users ?? []).filter((user) =>
    harnessDomains.some((domain) => (user.email ?? "").endsWith(`@${domain}`)),
  );

  let authUsersDeleted = 0;

  for (const user of harnessUsers) {
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) {
      console.warn(`Could not delete auth user ${user.email}: ${error.message}`);
      continue;
    }
    authUsersDeleted += 1;
  }

  return { wardDeleted: true, authUsersDeleted };
}

async function main(): Promise<void> {
  console.log(`Cleaning harness data from ${describeTarget()}`);
  console.log(`  ward ids: ${HARNESS_WARD_IDS.join(", ")}`);
  console.log(`  units:    ${TEST_STAKE_UNIT_ID} and its two ward units`);
  console.log(`  auth users on: @${TEST_EMAIL_DOMAIN}`);
  console.log(`                 @${TEST_YOUTH_EMAIL_DOMAIN}`);

  const result = await cleanUpTestData();

  console.log(
    `\nDone. Both test wards and their units removed, ` +
      `${result.authUsersDeleted} harness auth user(s) deleted.`,
  );
  console.log("Nothing outside the test wards was touched.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`\nCleanup failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
