// @vitest-environment node

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { emitNotification } from "@/lib/notifications/emitNotification";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

// Each assertion uses its own trigger key so the suites stay independent of one another and
// of any row order.
const ROLE_RESOLUTION_TRIGGER = "plan_submitted";
const OPT_OUT_TRIGGER = "plan_approved";
const DISABLED_TRIGGER = "issue_flagged_post_sunday";
const EXPLICIT_RECIPIENT_TRIGGER = "sunday_confirmation_request";
const ADMIN_TRIGGER = "admin_setting_changed";

describe("emitNotification", () => {
  let fixtures: Fixtures;

  async function recipientsFor(triggerKey: string): Promise<string[]> {
    const { data, error } = await fixtures.service
      .from("notifications")
      .select("recipient_user_id")
      .eq("ward_id", fixtures.wardAId)
      .eq("trigger_key", triggerKey);

    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.recipient_user_id).sort();
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(
      ["bishop", "counselor1", "counselor2", "eqPresident"],
      {
        notificationTriggers: [
          {
            triggerKey: ROLE_RESOLUTION_TRIGGER,
            defaultRoles: ["bishop", "counselor"],
          },
          { triggerKey: OPT_OUT_TRIGGER, defaultRoles: ["bishop", "counselor"] },
          {
            triggerKey: DISABLED_TRIGGER,
            defaultRoles: ["bishop", "counselor"],
            isGloballyEnabled: false,
          },
          {
            triggerKey: EXPLICIT_RECIPIENT_TRIGGER,
            defaultRoles: ["bishop"],
          },
          { triggerKey: ADMIN_TRIGGER, defaultRoles: ["bishop", "counselor"] },
        ],
      },
    );
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves recipients from default_roles", async () => {
    await emitNotification(
      {
        wardId: fixtures.wardAId,
        triggerKey: ROLE_RESOLUTION_TRIGGER,
        title: "Plan submitted",
        body: "March plan is ready for review",
      },
      fixtures.service,
    );

    const expected = [
      fixtures.user("bishop").id,
      fixtures.user("counselor1").id,
      fixtures.user("counselor2").id,
    ].sort();

    expect(await recipientsFor(ROLE_RESOLUTION_TRIGGER)).toEqual(expected);
  });

  it("does not notify roles outside default_roles", async () => {
    expect(await recipientsFor(ROLE_RESOLUTION_TRIGGER)).not.toContain(
      fixtures.user("eqPresident").id,
    );
  });

  it("writes nothing when the trigger is globally disabled", async () => {
    await emitNotification(
      {
        wardId: fixtures.wardAId,
        triggerKey: DISABLED_TRIGGER,
        title: "Issue flagged",
        body: "Should not be delivered",
      },
      fixtures.service,
    );

    expect(await recipientsFor(DISABLED_TRIGGER)).toEqual([]);
  });

  // FEATURES.md §Module 14: the opt-out is personal. A colleague holding the same role must
  // still receive the notification, or one user's preference silently mutes the whole role.
  it("excludes an opted-out user while their same-role colleague still receives it", async () => {
    const { error } = await fixtures.service.from("notification_user_prefs").insert({
      ward_id: fixtures.wardAId,
      user_id: fixtures.user("counselor1").id,
      trigger_key: OPT_OUT_TRIGGER,
      is_enabled: false,
    });
    if (error) throw new Error(error.message);

    await emitNotification(
      {
        wardId: fixtures.wardAId,
        triggerKey: OPT_OUT_TRIGGER,
        title: "Plan approved",
        body: "March plan approved",
      },
      fixtures.service,
    );

    const recipients = await recipientsFor(OPT_OUT_TRIGGER);

    expect(recipients).not.toContain(fixtures.user("counselor1").id);
    expect(recipients).toContain(fixtures.user("counselor2").id);
    expect(recipients).toContain(fixtures.user("bishop").id);
  });

  // Honouring the opt-out only on the role-resolved path would make a product promise depend
  // on the shape of the calling code.
  it("honours the opt-out for explicitly addressed recipients too", async () => {
    const { error } = await fixtures.service.from("notification_user_prefs").insert({
      ward_id: fixtures.wardAId,
      user_id: fixtures.user("counselor2").id,
      trigger_key: EXPLICIT_RECIPIENT_TRIGGER,
      is_enabled: false,
    });
    if (error) throw new Error(error.message);

    await emitNotification(
      {
        wardId: fixtures.wardAId,
        triggerKey: EXPLICIT_RECIPIENT_TRIGGER,
        title: "Confirm Sunday",
        body: "Please confirm",
        recipientUserIds: [
          fixtures.user("counselor1").id,
          fixtures.user("counselor2").id,
        ],
      },
      fixtures.service,
    );

    const recipients = await recipientsFor(EXPLICIT_RECIPIENT_TRIGGER);

    expect(recipients).toEqual([fixtures.user("counselor1").id]);
  });

  // A trigger that fires into nothing with no trace is the worst of the three outcomes, so
  // an unknown key must be loud without being fatal.
  it("warns, inserts nothing, and does not throw on an unknown trigger key", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      emitNotification(
        {
          wardId: fixtures.wardAId,
          triggerKey: "not_a_real_trigger",
          title: "Nowhere",
          body: "Nothing should happen",
        },
        fixtures.service,
      ),
    ).resolves.toBeUndefined();

    expect(consoleWarn).toHaveBeenCalled();
    expect(JSON.stringify(consoleWarn.mock.calls)).toContain("not_a_real_trigger");
    expect(await recipientsFor("not_a_real_trigger")).toEqual([]);
  });

  it("does not throw when the client fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      emitNotification(
        {
          wardId: fixtures.wardAId,
          triggerKey: ROLE_RESOLUTION_TRIGGER,
          title: "Boom",
          body: "Boom",
        },
        {
          from: () => {
            throw new Error("simulated client explosion");
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately malformed client, standing in for a runtime failure
        } as any,
      ),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
  });
});

describe("notifyOtherBishopric", () => {
  let fixtures: Fixtures;

  beforeAll(async () => {
    fixtures = await seedFixtures(
      ["bishop", "counselor1", "counselor2", "eqPresident"],
      {
        notificationTriggers: [
          { triggerKey: ADMIN_TRIGGER, defaultRoles: ["bishop", "counselor"] },
        ],
      },
    );
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("notifies exactly the other two and never the acting user", async () => {
    await notifyOtherBishopric(
      {
        wardId: fixtures.wardAId,
        actingUserId: fixtures.user("bishop").id,
        description: "Changed the agenda email send time",
      },
      fixtures.service,
    );

    const { data, error } = await fixtures.service
      .from("notifications")
      .select("recipient_user_id, body")
      .eq("ward_id", fixtures.wardAId)
      .eq("trigger_key", ADMIN_TRIGGER);

    expect(error).toBeNull();

    const recipients = (data ?? []).map((row) => row.recipient_user_id).sort();

    expect(recipients).toEqual(
      [fixtures.user("counselor1").id, fixtures.user("counselor2").id].sort(),
    );
    expect(recipients).not.toContain(fixtures.user("bishop").id);
    expect(data?.[0]?.body).toBe("Changed the agenda email send time");
  });

  it("does not notify non-bishopric roles", async () => {
    const { data } = await fixtures.service
      .from("notifications")
      .select("recipient_user_id")
      .eq("ward_id", fixtures.wardAId)
      .eq("trigger_key", ADMIN_TRIGGER);

    expect((data ?? []).map((row) => row.recipient_user_id)).not.toContain(
      fixtures.user("eqPresident").id,
    );
  });
});
