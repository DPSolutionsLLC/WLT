import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

export type EmitNotificationParams = {
  wardId: string;
  triggerKey: string;
  title: string;
  body: string;
  recipientUserIds?: string[];
};

// Uses the service-role client, not the caller's session — still correct after migration 020
// replaced the self-only `users` SELECT policy with a ward-scoped one. The reason was never
// only the read: this module inserts `notifications` rows addressed to OTHER users and reads
// `notification_user_prefs` rows belonging to them, and no caller's own session can do either.
// It is a server-only module; it reads ids to address rows and returns none of that data to
// the caller.
//
// ---------------------------------------------------------------------------
// RECIPIENTS ARE RESOLVED FROM CALLINGS, NOT FROM `users`
// ---------------------------------------------------------------------------
// This asked `users` for `(ward_id, role, is_active)`, which answers "whose ACCOUNT lives in this
// ward and carries this role". Under the calling model (migration 068) that is the wrong
// question: a Relief Society president whose account lives in ward A holds a real calling in ward
// B, and ward B's notifications are hers.
//
// Missing this is `notification-trigger-drift`'s other half exactly — flagging a follow-up
// "stamped flag_sent_at, logged notified: true and delivered NOTHING". emitNotification returns
// without an error when nobody matches, so the failure is SILENT BY CONSTRUCTION. All four
// helpers in lib/notifications/ were changed in one commit for that reason.
//
// JOINED TO `users.is_active`, because a calling can be active on a deactivated account (that is
// the point of keeping the two columns apart — see lib/callings/writeCalling.ts) and a
// deactivated person must not be notified. `!inner` is what makes the join a filter rather than
// an optional embed.
async function resolveRoleRecipients(
  supabase: SupabaseClient<Database>,
  wardId: string,
  roles: string[],
): Promise<string[]> {
  if (roles.length === 0) return [];

  const { data, error } = await supabase
    .from("ward_role_assignments")
    .select("user_id, users!user_id!inner(is_active)")
    .eq("ward_id", wardId)
    .eq("is_active", true)
    .eq("users.is_active", true)
    .in("role", roles);

  if (error) {
    console.error("Could not resolve notification recipients by role", {
      wardId,
      roles,
      error: error.message,
    });
    return [];
  }

  // Distinct PEOPLE, not rows. One active calling per ward is enforced by
  // `ward_role_assignments_one_per_ward`, so this cannot duplicate today — but addressing one
  // person twice would insert two notifications, and that is not a thing to leave to an index.
  return [...new Set((data ?? []).map((row) => row.user_id))];
}

async function readOptedOutUserIds(
  supabase: SupabaseClient<Database>,
  wardId: string,
  triggerKey: string,
  candidateUserIds: string[],
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("notification_user_prefs")
    .select("user_id")
    .eq("ward_id", wardId)
    .eq("trigger_key", triggerKey)
    .eq("is_enabled", false)
    .in("user_id", candidateUserIds);

  if (error) {
    console.error("Could not read notification opt-outs", {
      wardId,
      triggerKey,
      error: error.message,
    });
    return new Set();
  }

  return new Set((data ?? []).map((row) => row.user_id));
}

// Never throws — same contract as writeAuditLog. A notification outage must not become an
// app outage.
export async function emitNotification(
  params: EmitNotificationParams,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const { wardId, triggerKey, title, body, recipientUserIds } = params;

  try {
    const supabase = client ?? createServiceSupabaseClient();

    const { data: setting, error: settingError } = await supabase
      .from("notification_settings")
      .select("default_roles, is_globally_enabled")
      .eq("ward_id", wardId)
      .eq("trigger_key", triggerKey)
      .maybeSingle();

    if (settingError) {
      console.error("Could not read notification settings", {
        wardId,
        triggerKey,
        error: settingError.message,
      });
      return;
    }

    // A trigger that fires into nothing with no trace is the worst outcome of the three, so
    // an unknown key warns loudly rather than failing silently or throwing.
    if (!setting) {
      console.warn(
        `Unknown notification trigger "${triggerKey}" for ward ${wardId}. ` +
          "No notification was sent. Check the key against supabase/seed/notification_triggers.sql.",
      );
      return;
    }

    if (!setting.is_globally_enabled) return;

    const candidateUserIds =
      recipientUserIds ??
      (await resolveRoleRecipients(supabase, wardId, setting.default_roles));

    if (candidateUserIds.length === 0) return;

    // The per-user opt-out applies to explicitly addressed recipients too. FEATURES.md
    // §Module 14 promises a user can opt out of any individual notification; honouring that
    // only on the role-resolved path would make the promise depend on the caller's shape.
    const optedOut = await readOptedOutUserIds(
      supabase,
      wardId,
      triggerKey,
      candidateUserIds,
    );

    const recipients = candidateUserIds.filter((id) => !optedOut.has(id));
    if (recipients.length === 0) return;

    const { error: insertError } = await supabase.from("notifications").insert(
      recipients.map((recipientUserId) => ({
        ward_id: wardId,
        recipient_user_id: recipientUserId,
        trigger_key: triggerKey,
        title,
        body,
      })),
    );

    if (insertError) {
      console.error("Notification insert rejected by the database", {
        wardId,
        triggerKey,
        recipientCount: recipients.length,
        error: insertError.message,
      });
    }
  } catch (error) {
    console.error("emitNotification threw", { wardId, triggerKey, error });
  }
}
