import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";
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
type OrgKey = "eldersQuorum" | "reliefSociety" | "wardBOrg";

type HandleSpec = {
  role: Role;
  ward: WardKey;
  org?: OrgKey;
  counselorPosition?: 1 | 2;
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
  musicCoordinator: { role: "music_coordinator", ward: "A" },
  wardCouncilMember: { role: "ward_council_member", ward: "A" },
  sacramentManager: { role: "sacrament_manager", ward: "A" },
  sacramentManagerInactive: { role: "sacrament_manager", ward: "A" },
  wardBBishop: { role: "bishop", ward: "B" },
  wardBEqPresident: { role: "org_president", ward: "B", org: "wardBOrg" },
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

export type SeedOptions = {
  crossOrgVisibility?: boolean;
  notificationTriggers?: NotificationTriggerSeed[];
};

export type Fixtures = {
  runId: string;
  service: SupabaseClient<Database>;
  wardAId: string;
  wardBId: string;
  eldersQuorumId: string;
  reliefSocietyId: string;
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
  const eldersQuorumId = randomUUID();
  const reliefSocietyId = randomUUID();
  const wardBOrgId = randomUUID();

  const createdAuthUserIds: string[] = [];

  const cleanup = async () => {
    // Wards first: every ward-scoped table cascades from wards (including public.users), so
    // this clears the rows that would otherwise block an auth-user delete through a
    // no-action foreign key such as visit_goals.created_by.
    for (const wardId of [wardAId, wardBId]) {
      const { error } = await service.from("wards").delete().eq("id", wardId);
      if (error) {
        console.warn(`Fixture cleanup could not delete ward ${wardId}`, error.message);
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
    const { error: wardError } = await service.from("wards").insert([
      {
        id: wardAId,
        name: `${FIXTURE_EMAIL_PREFIX} ward A ${runId}`,
        settings: {
          cross_org_visibility: options.crossOrgVisibility ?? false,
          timezone: "America/Denver",
        },
      },
      {
        id: wardBId,
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

      const { error: rowError } = await service.from("users").insert({
        id: created.user.id,
        ward_id: wardId,
        first_name: handle,
        last_name: `Fixture${runId}`,
        email,
        role: spec.role,
        org_id: orgId,
        counselor_position: spec.counselorPosition ?? null,
      });

      if (rowError) {
        throw new Error(
          `Could not create public.users row for "${handle}": ${rowError.message}`,
        );
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
      eldersQuorumId,
      reliefSocietyId,
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

export async function setCrossOrgVisibility(
  fixtures: Fixtures,
  isEnabled: boolean,
): Promise<void> {
  const { error } = await fixtures.service
    .from("wards")
    .update({
      settings: {
        cross_org_visibility: isEnabled,
        timezone: "America/Denver",
      },
    })
    .eq("id", fixtures.wardAId);

  if (error) {
    throw new Error(
      `Could not set cross_org_visibility=${isEnabled}: ${error.message}`,
    );
  }
}
