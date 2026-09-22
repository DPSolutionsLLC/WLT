import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database, Json } from "@/types/database";
import type { Role } from "@/types/domain";

// Fixtures are created with the SERVICE-ROLE client and asserted with an authenticated one
// (tests/helpers/asRole.ts). Asserting with this client tests nothing — it bypasses RLS
// entirely, which is the single easiest way to write six suites that pass while the app leaks.
//
// These suites run against the shared hosted project (CLAUDE.md §9) and they write, so every
// fixture carries a per-run id and is deleted by id in afterAll. Never TRUNCATE, and never
// reach for `npm run db:reset` to clean up — both are a production wipe here.

export const FIXTURE_EMAIL_PREFIX = "wlt-test";

type WardKey = "A" | "B";
type OrgKey = "eldersQuorum" | "reliefSociety" | "youngWomen" | "youngMen" | "wardBOrg";

type UnitKey = "stake" | "outsideStake";

// A handle's `ward` is still their HOME ward — where their ACCOUNT lives. It is also where their
// first calling is created, so for everybody with no `secondCalling` the two are the same thing
// and nothing about a fixture changed.
//
// `unit: null` means an assignment over EVERY unit, which the unit_assignments_scope CHECK
// permits only for `super_admin` (migration 065b).
type UnitAssignmentSpec = {
  role: "stake_president" | "stake_counselor" | "stake_secretary" | "super_admin";
  unit: UnitKey | null;
};

// A SECOND REAL CALLING, IN A SECOND WARD (migration 068). Not a visitor and not a reduced tier:
// this person is on that ward's roster with that ward's role, and carries exactly the access that
// role carries there.
//
// Its `role` and `org` are deliberately independent of the first calling's — the case the whole
// model turns on is somebody who is one thing in ward A and another thing in ward B, so a fixture
// that copied the home role could not express the thing under test.
type SecondCallingSpec = {
  ward: WardKey;
  role: Role;
  org?: OrgKey;
  counselorPosition?: 1 | 2;
};

type HandleSpec = {
  role: Role;
  ward: WardKey;
  org?: OrgKey;
  counselorPosition?: 1 | 2;
  unitAssignment?: UnitAssignmentSpec;
  secondCalling?: SecondCallingSpec;
};

// Keyed by handle rather than by role: ward A holds two org presidents in different
// organizations, and the org-isolation suite is meaningless unless it can tell them apart.
const HANDLE_SPECS = {
  bishop: { role: "bishop", ward: "A" },
  counselor1: { role: "counselor", ward: "A", counselorPosition: 1 },
  counselor2: { role: "counselor", ward: "A", counselorPosition: 2 },
  wardSecretary: { role: "ward_secretary", ward: "A" },
  executiveSecretary: { role: "executive_secretary", ward: "A" },
  eqPresident: { role: "org_president", ward: "A", org: "eldersQuorum" },
  eqCounselor: { role: "org_counselor", ward: "A", org: "eldersQuorum" },
  eqSecretary: { role: "org_secretary", ward: "A", org: "eldersQuorum" },
  rsPresident: { role: "org_president", ward: "A", org: "reliefSociety" },
  // THE ORGANIZATIONS THAT MANAGE YOUTH, from P2 on. The permission matrix became
  // organization-aware: `youth_activities.manage` belongs to Young Women (and to Young Men, whose
  // organization exists in this schema even though the bishopric is its presidency), while the
  // Elders Quorum, the Relief Society and the Primary support the youth without managing them.
  //
  // The youth route suites used `eqPresident` as "the org leader who owns this profile" and that
  // role no longer manages youth at all, so they use these instead. `ymPresident` is the
  // DIFFERENT organization foil — it also holds manage, so a refusal there proves the ORG
  // scoping rather than merely proving the permission is missing, which is what an Elders Quorum
  // president would now prove instead.
  ywPresident: { role: "org_president", ward: "A", org: "youngWomen" },
  ywSecretary: { role: "org_secretary", ward: "A", org: "youngWomen" },
  ymPresident: { role: "org_president", ward: "A", org: "youngMen" },
  musicCoordinator: { role: "music_coordinator", ward: "A" },
  wardCouncilMember: { role: "ward_council_member", ward: "A" },
  sacramentManager: { role: "sacrament_manager", ward: "A" },
  sacramentManagerInactive: { role: "sacrament_manager", ward: "A" },
  wardBBishop: { role: "bishop", ward: "B" },
  wardBEqPresident: { role: "org_president", ward: "B", org: "wardBOrg" },
  // Home ward A, assigned over the stake that is parent to BOTH ward units — so ward B is
  // reachable by an authorized switch and ward A is reachable because it is already theirs.
  stakePresident: {
    role: "stake_president",
    ward: "A",
    unitAssignment: { role: "stake_president", unit: "stake" },
  },
  // Assigned over a SECOND stake that is parent to nothing. The negative case the phase turns on:
  // holding a stake assignment is not the same as holding one over THIS ward.
  outsideStakePresident: {
    role: "stake_president",
    ward: "A",
    unitAssignment: { role: "stake_president", unit: "outsideStake" },
  },
  superAdmin: {
    role: "super_admin",
    ward: "A",
    unitAssignment: { role: "super_admin", unit: null },
  },
  // THE MODEL, AS A FIXTURE. Relief Society president in ward A, ward secretary in ward B — a
  // different role, a different organization and a different set of permissions in each, from one
  // account. Every assertion in tests/rls/ward-callings*.test.ts is about this handle.
  //
  // The two callings disagree on purpose: `org_president` holds `visits.*` and no `agendas.*`,
  // `ward_secretary` the reverse, so "which role is this session" has a visible answer rather
  // than only a stored one.
  twoCallings: {
    role: "org_president",
    ward: "A",
    org: "reliefSociety",
    secondCalling: { ward: "B", role: "ward_secretary" },
  },
  // The same shape with a BISHOP calling in ward B, so is_bishopric() can be asserted true and
  // false for ONE PERSON depending only on which ward they are acting in. Ward A's calling is
  // deliberately not bishopric — `wardBBishop` already covers a bishop who lives there.
  twoCallingsBishopAway: {
    role: "music_coordinator",
    ward: "A",
    secondCalling: { ward: "B", role: "bishop" },
  },
} as const satisfies Record<string, HandleSpec>;

export type FixtureHandle = keyof typeof HANDLE_SPECS;

export type SeededUser = {
  handle: FixtureHandle;
  id: string;
  email: string;
  password: string;
  role: Role;
  wardId: string;
  orgId: string | null;
};

export type NotificationTriggerSeed = {
  triggerKey: string;
  defaultRoles: Role[];
  isGloballyEnabled?: boolean;
};

export type RoleAccessSeed = Record<string, { add?: string[]; remove?: string[] }>;

export type SeedOptions = {
  crossOrgVisibility?: boolean;
  // Ward A only. A cross-ward test needs one side left unconfigured, so ward B never takes one.
  roleAccess?: RoleAccessSeed;
  notificationTriggers?: NotificationTriggerSeed[];
};

export type Fixtures = {
  runId: string;
  service: SupabaseClient<Database>;
  wardAId: string;
  wardBId: string;
  // The unit hierarchy (migration 065). `stakeUnitId` is the parent of BOTH ward units;
  // `outsideStakeUnitId` is a second stake that is parent to nothing, which is what makes
  // "holds a stake assignment" and "holds one over this ward" distinguishable in a test.
  stakeUnitId: string;
  outsideStakeUnitId: string;
  wardAUnitId: string;
  wardBUnitId: string;
  eldersQuorumId: string;
  reliefSocietyId: string;
  youngWomenId: string;
  youngMenId: string;
  wardBOrgId: string;
  users: Partial<Record<FixtureHandle, SeededUser>>;
  user: (handle: FixtureHandle) => SeededUser;
  cleanup: () => Promise<void>;
};

function assertEnvironment(): void {
  const missing = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ].filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(
      `Cannot seed test fixtures: missing ${missing.join(", ")}. ` +
        "Copy .env.local.example to .env.local and fill in the linked project's keys.",
    );
  }
}

export async function seedFixtures(
  handles: readonly FixtureHandle[],
  options: SeedOptions = {},
): Promise<Fixtures> {
  assertEnvironment();

  const service = createServiceSupabaseClient();
  const runId = randomUUID().slice(0, 8);
  const password = `${FIXTURE_EMAIL_PREFIX}-${runId}-Aa1!`;

  const wardAId = randomUUID();
  const wardBId = randomUUID();
  const stakeUnitId = randomUUID();
  const outsideStakeUnitId = randomUUID();
  const wardAUnitId = randomUUID();
  const wardBUnitId = randomUUID();
  const eldersQuorumId = randomUUID();
  const reliefSocietyId = randomUUID();
  const youngWomenId = randomUUID();
  const youngMenId = randomUUID();
  const wardBOrgId = randomUUID();

  const createdAuthUserIds: string[] = [];

  const cleanup = async () => {
    // Wards first: every ward-scoped table cascades from wards (including public.users), so
    // this clears the rows that would otherwise block an auth-user delete through a
    // no-action foreign key such as visit_goals.created_by.
    //
    // ⚠️ BOTH WARDS IN ONE STATEMENT, AND THAT IS NOT TIDINESS — IT IS REQUIRED SINCE MIGRATION
    // 069. Deleting them one at a time leaves the fixtures half-deleted in the shared hosted
    // project, which is the worst outcome this file has.
    //
    // A person can now hold a calling in ward B while their account lives in ward A, and the rows
    // they wrote over there — `activity_logs.logged_by`, `visit_logs.recorded_by`,
    // `programs.approved_by` — reference them by a SINGLE-column key with no `on delete` action.
    // Under the old composite `(author, ward_id)` key such a row could not exist at all, so ward
    // by ward was safe; now, deleting ward A cascades its `users` rows while ward B's rows still
    // point at them, and Postgres refuses with `activity_logs_logged_by_ward_id_fkey`.
    //
    // One DELETE covering both wards removes every such row in the same statement, and referential
    // integrity is checked once at the end of it — by which time the referencing rows are gone
    // too. Deleting ward B before ward A would work for today's fixtures and break the first time
    // somebody's account lives in B with a calling in A.
    const { error: wardError } = await service
      .from("wards")
      .delete()
      .in("id", [wardAId, wardBId]);
    if (wardError) {
      console.warn(
        `Fixture cleanup could not delete wards ${wardAId} and ${wardBId}`,
        wardError.message,
      );
    }

    // AFTER the wards, and explicitly — `units` rows do NOT cascade from `wards`, because the
    // foreign key points the other way (wards.unit_id → units.id). Deleting the wards is what
    // clears that reference; `on delete restrict` on units.parent_id is why the two child units
    // must go before the two stakes.
    for (const unitId of [wardAUnitId, wardBUnitId, stakeUnitId, outsideStakeUnitId]) {
      const { error } = await service.from("units").delete().eq("id", unitId);
      if (error) {
        console.warn(`Fixture cleanup could not delete unit ${unitId}`, error.message);
      }
    }

    for (const authUserId of createdAuthUserIds) {
      const { error } = await service.auth.admin.deleteUser(authUserId);
      if (error) {
        console.warn(
          `Fixture cleanup could not delete auth user ${authUserId} (run ${runId})`,
          error.message,
        );
      }
    }
  };

  try {
    // The unit hierarchy first: `wards.unit_id` references it, so the units must exist before the
    // wards that point at them. Both ward units hang off ONE stake, which is what makes a switch
    // from ward A into ward B authorized — can_act_in_ward() walks wards.unit_id → parent_id.
    const { error: unitError } = await service.from("units").insert([
      {
        id: stakeUnitId,
        type: "stake",
        name: `${FIXTURE_EMAIL_PREFIX} stake ${runId}`,
      },
      {
        id: outsideStakeUnitId,
        type: "stake",
        name: `${FIXTURE_EMAIL_PREFIX} outside stake ${runId}`,
      },
      {
        id: wardAUnitId,
        type: "ward",
        parent_id: stakeUnitId,
        name: `${FIXTURE_EMAIL_PREFIX} ward A unit ${runId}`,
      },
      {
        id: wardBUnitId,
        type: "ward",
        parent_id: stakeUnitId,
        name: `${FIXTURE_EMAIL_PREFIX} ward B unit ${runId}`,
      },
    ]);
    if (unitError) throw new Error(`Could not seed units: ${unitError.message}`);

    const { error: wardError } = await service.from("wards").insert([
      {
        id: wardAId,
        unit_id: wardAUnitId,
        name: `${FIXTURE_EMAIL_PREFIX} ward A ${runId}`,
        settings: {
          cross_org_visibility: options.crossOrgVisibility ?? false,
          timezone: "America/Denver",
          ...(options.roleAccess ? { role_access: options.roleAccess } : {}),
        },
      },
      {
        id: wardBId,
        unit_id: wardBUnitId,
        name: `${FIXTURE_EMAIL_PREFIX} ward B ${runId}`,
        settings: { cross_org_visibility: false, timezone: "America/Denver" },
      },
    ]);
    if (wardError) throw new Error(`Could not seed wards: ${wardError.message}`);

    const { error: orgError } = await service.from("organizations").insert([
      {
        id: eldersQuorumId,
        ward_id: wardAId,
        name: "Elders Quorum",
        type: "elders_quorum",
      },
      {
        id: reliefSocietyId,
        ward_id: wardAId,
        name: "Relief Society",
        type: "relief_society",
      },
      {
        id: youngWomenId,
        ward_id: wardAId,
        name: "Young Women",
        type: "young_women",
      },
      {
        id: youngMenId,
        ward_id: wardAId,
        name: "Young Men",
        type: "young_men",
      },
      {
        id: wardBOrgId,
        ward_id: wardBId,
        name: "Elders Quorum",
        type: "elders_quorum",
      },
    ]);
    if (orgError) {
      throw new Error(`Could not seed organizations: ${orgError.message}`);
    }

    const orgIds: Record<OrgKey, string> = {
      eldersQuorum: eldersQuorumId,
      reliefSociety: reliefSocietyId,
      youngWomen: youngWomenId,
      youngMen: youngMenId,
      wardBOrg: wardBOrgId,
    };

    const users: Partial<Record<FixtureHandle, SeededUser>> = {};

    for (const handle of handles) {
      const spec: HandleSpec = HANDLE_SPECS[handle];
      const wardId = spec.ward === "A" ? wardAId : wardBId;
      const orgId = spec.org ? orgIds[spec.org] : null;
      const email = `${FIXTURE_EMAIL_PREFIX}-${runId}-${handle.toLowerCase()}@wardleadershiptools.test`;

      const { data: created, error: authError } =
        await service.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });

      if (authError || !created.user) {
        throw new Error(
          `Could not create auth user for "${handle}": ${authError?.message ?? "no user returned"}`,
        );
      }

      createdAuthUserIds.push(created.user.id);

      // `role`, `org_id` and `counselor_position` ARE NOT WRITTEN HERE. They belong to the
      // CALLING (migration 068) and migration 071 drops all three columns; the app stopped
      // writing them in the same change, so a fixture that still did would seed a state no real
      // account can be in. 068d dropped NOT NULL off `users.role` to make this possible.
      const { error: rowError } = await service.from("users").insert({
        id: created.user.id,
        ward_id: wardId,
        first_name: handle,
        last_name: `Fixture${runId}`,
        email,
      });

      if (rowError) {
        throw new Error(
          `Could not create public.users row for "${handle}": ${rowError.message}`,
        );
      }

      // THE CALLING, always — one per fixture, in their home ward. Without it
      // current_user_role() returns null and every policy in the app fails closed, which would
      // make a whole suite fail for a reason that has nothing to do with what it is testing.
      const { error: callingError } = await service
        .from("ward_role_assignments")
        .insert({
          user_id: created.user.id,
          ward_id: wardId,
          role: spec.role,
          org_id: orgId,
          counselor_position: spec.counselorPosition ?? null,
        });

      if (callingError) {
        throw new Error(
          `Could not create the calling for "${handle}": ${callingError.message}`,
        );
      }

      // A SECOND REAL CALLING IN A SECOND WARD. `ward_role_assignments_one_per_ward` permits it
      // because the ward differs; two in the SAME ward would be refused, which is what keeps
      // current_user_role() single-valued.
      if (spec.secondCalling) {
        const secondWardId = spec.secondCalling.ward === "A" ? wardAId : wardBId;
        const secondOrgId = spec.secondCalling.org ? orgIds[spec.secondCalling.org] : null;

        const { error: secondCallingError } = await service
          .from("ward_role_assignments")
          .insert({
            user_id: created.user.id,
            ward_id: secondWardId,
            role: spec.secondCalling.role,
            org_id: secondOrgId,
            counselor_position: spec.secondCalling.counselorPosition ?? null,
          });

        if (secondCallingError) {
          throw new Error(
            `Could not create the second calling for "${handle}": ${secondCallingError.message}`,
          );
        }
      }

      // AFTER the public.users row: unit_assignments.user_id references it.
      if (spec.unitAssignment) {
        const unitIds: Record<UnitKey, string> = {
          stake: stakeUnitId,
          outsideStake: outsideStakeUnitId,
        };

        const { error: assignmentError } = await service.from("unit_assignments").insert({
          user_id: created.user.id,
          unit_id: spec.unitAssignment.unit ? unitIds[spec.unitAssignment.unit] : null,
          role: spec.unitAssignment.role,
        });

        if (assignmentError) {
          throw new Error(
            `Could not create unit_assignments row for "${handle}": ${assignmentError.message}`,
          );
        }
      }

      users[handle] = {
        handle,
        id: created.user.id,
        email,
        password,
        role: spec.role,
        wardId,
        orgId,
      };
    }

    if (options.notificationTriggers?.length) {
      const { error: triggerError } = await service
        .from("notification_settings")
        .insert(
          options.notificationTriggers.flatMap((trigger) =>
            [wardAId, wardBId].map((wardId) => ({
              ward_id: wardId,
              trigger_key: trigger.triggerKey,
              default_roles: trigger.defaultRoles,
              is_globally_enabled: trigger.isGloballyEnabled ?? true,
            })),
          ),
        );

      if (triggerError) {
        throw new Error(
          `Could not seed notification settings: ${triggerError.message}`,
        );
      }
    }

    return {
      runId,
      service,
      wardAId,
      wardBId,
      stakeUnitId,
      outsideStakeUnitId,
      wardAUnitId,
      wardBUnitId,
      eldersQuorumId,
      reliefSocietyId,
      youngWomenId,
      youngMenId,
      wardBOrgId,
      users,
      user(handle) {
        const seeded = users[handle];
        if (!seeded) {
          throw new Error(
            `Fixture "${handle}" was not requested by this suite. Add it to seedFixtures([...]).`,
          );
        }
        return seeded;
      },
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

// Reads the existing settings and writes back a merged object rather than a fresh one. It used
// to write { cross_org_visibility, timezone } wholesale, which was harmless only while those were
// the sole keys. Now that role_access lives in settings too, a suite that seeded an override and
// then called this would silently lose it and pass for the wrong reason.
async function updateWardASettings(
  fixtures: Fixtures,
  changes: Record<string, unknown>,
  description: string,
): Promise<void> {
  const { data, error: readError } = await fixtures.service
    .from("wards")
    .select("settings")
    .eq("id", fixtures.wardAId)
    .maybeSingle();

  if (readError) {
    throw new Error(`Could not read ward settings to ${description}: ${readError.message}`);
  }

  const existing =
    data?.settings && typeof data.settings === "object" && !Array.isArray(data.settings)
      ? (data.settings as Record<string, unknown>)
      : {};

  const { error } = await fixtures.service
    .from("wards")
    .update({ settings: { ...existing, ...changes } as Json })
    .eq("id", fixtures.wardAId);

  if (error) {
    throw new Error(`Could not ${description}: ${error.message}`);
  }
}

export async function setCrossOrgVisibility(
  fixtures: Fixtures,
  isEnabled: boolean,
): Promise<void> {
  await updateWardASettings(
    fixtures,
    { cross_org_visibility: isEnabled },
    `set cross_org_visibility=${isEnabled}`,
  );
}

// Changes ward A's role_access mid-suite. Nothing in the app writes this yet — the Phase 11
// screen that will own it does not exist — so seeding is the only way to reach the state.
export async function setRoleAccess(
  fixtures: Fixtures,
  override: RoleAccessSeed,
): Promise<void> {
  await updateWardASettings(
    fixtures,
    { role_access: override },
    `set role_access to ${JSON.stringify(override)}`,
  );
}
