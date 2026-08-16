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
async function resolveRoleRecipients(
  supabase: SupabaseClient<Database>,
  wardId: string,
  roles: string[],
): Promise<string[]> {
  if (roles.length === 0) return [];

  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("ward_id", wardId)
    .eq("is_active", true)
    .in("role", roles);

  if (error) {
    console.error("Could not resolve notification recipients by role", {
      wardId,
      roles,
      error: error.message,
    });
    return [];
  }

  return (data ?? []).map((row) => row.id);
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
