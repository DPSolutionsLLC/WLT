import { pathToFileURL } from "node:url";
import { describeTarget, getAdminClient } from "./adminClient.ts";
import {
  DEVELOPMENT_WARD_ID,
  TEST_EMAIL_DOMAIN,
  TEST_WARD_ID,
} from "./seedUtils.ts";

// ============================================================================
// There is no emulator to wipe, and `npm run db:reset` against the linked project is a
// production wipe (CLAUDE.md §9). So cleanup is narrow by construction: it deletes exactly
// one ward by id and exactly the auth users whose email sits on the harness domain. It never
// truncates, never deletes by pattern across tables, and never touches a ward it was not
// told about at compile time.
// ============================================================================

function assertSafeTarget(): void {
  // Widened deliberately: both are literal constants, so a direct comparison is a compile
  // error rather than a runtime guard. The check still has to exist, because the whole point
  // is to fail loudly if someone ever repoints TEST_WARD_ID at real data.
  const target: string = TEST_WARD_ID;

  if (target === DEVELOPMENT_WARD_ID) {
    throw new Error(
      "Refusing to run: the harness ward id matches the Development Ward. Cleanup would " +
        "delete the committed seed data from supabase/seed/ward.sql.",
    );
  }

  if (!/^[0-9a-f-]{36}$/i.test(target)) {
    throw new Error(`Refusing to run: "${target}" is not a well-formed ward id.`);
  }
}

export type CleanUpResult = {
  wardDeleted: boolean;
  authUsersDeleted: number;
};

export async function cleanUpTestData(): Promise<CleanUpResult> {
  assertSafeTarget();

  const supabase = getAdminClient();

  // The ward goes first. Every ward-scoped table cascades from `wards`, which clears the rows
  // that would otherwise block an auth-user delete through a no-action foreign key such as
  // sundays.conducting_user_id.
  const { error: wardError } = await supabase
    .from("wards")
    .delete()
    .eq("id", TEST_WARD_ID);

  if (wardError) {
    throw new Error(`Could not delete the test ward: ${wardError.message}`);
  }

  const { data: listed, error: listError } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  });

  if (listError) {
    throw new Error(`Could not list auth users: ${listError.message}`);
  }

  const harnessUsers = (listed?.users ?? []).filter((user) =>
    (user.email ?? "").endsWith(`@${TEST_EMAIL_DOMAIN}`),
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
  console.log(`  ward id: ${TEST_WARD_ID}`);
  console.log(`  auth users on: @${TEST_EMAIL_DOMAIN}`);

  const result = await cleanUpTestData();

  console.log(
    `\nDone. Test ward removed, ${result.authUsersDeleted} harness auth user(s) deleted.`,
  );
  console.log("Nothing outside the test ward was touched.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`\nCleanup failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
