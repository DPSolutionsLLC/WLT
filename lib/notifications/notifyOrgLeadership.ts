import type { SupabaseClient } from "@supabase/supabase-js";
import { emitNotification } from "@/lib/notifications/emitNotification";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

export type NotifyOrgLeadershipParams = {
  wardId: string;
  orgId: string;
  actingUserId: string;
  description: string;
  title?: string;
};

const ORG_ROTATION_TRIGGER_KEY = "org_conducting_rotation_changed";

const ORG_LEADERSHIP_ROLES = ["org_president", "org_counselor", "org_secretary"];

// The organization counterpart of notifyOtherBishopric(). The reason that one exists — shared
// authority feels shared only when the others are told — applies identically to a presidency of
// three, and an org rotation is exactly the kind of change the other two would otherwise discover
// on a Sunday morning.
//
// Recipients are resolved EXPLICITLY and passed in, rather than left to the trigger's
// default_roles. default_roles would reach every org president in the ward; this change concerns
// one organization, and the Relief Society presidency has no business hearing about the Elders
// Quorum's rotation.
//
// Never throws. The write it follows has already committed, and a notification failure must
// degrade the message rather than fail the edit — the same rule notifyOtherBishopric follows.
export async function notifyOrgLeadership(
  params: NotifyOrgLeadershipParams,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const { wardId, orgId, actingUserId, description, title } = params;

  try {
    const supabase = client ?? createServiceSupabaseClient();

    const { data, error } = await supabase
      .from("users")
      .select("id")
      .eq("ward_id", wardId)
      .eq("org_id", orgId)
      .eq("is_active", true)
      .in("role", ORG_LEADERSHIP_ROLES)
      .neq("id", actingUserId);

    if (error) {
      console.error("Could not resolve the organization's leadership", {
        wardId,
        orgId,
        actingUserId,
        error: error.message,
      });
      return;
    }

    const recipientUserIds = (data ?? []).map((row) => row.id);
    if (recipientUserIds.length === 0) return;

    await emitNotification(
      {
        wardId,
        triggerKey: ORG_ROTATION_TRIGGER_KEY,
        title: title ?? "Organization conducting changed",
        body: description,
        recipientUserIds,
      },
      supabase,
    );
  } catch (error) {
    console.error("notifyOrgLeadership threw", {
      wardId,
      orgId,
      actingUserId,
      error,
    });
  }
}
