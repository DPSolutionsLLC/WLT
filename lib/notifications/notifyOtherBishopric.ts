import type { SupabaseClient } from "@supabase/supabase-js";
import { BISHOPRIC_ROLES } from "@/lib/auth/permissions";
import { emitNotification } from "@/lib/notifications/emitNotification";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

export type NotifyOtherBishopricParams = {
  wardId: string;
  actingUserId: string;
  description: string;
  title?: string;
};

const ADMIN_CHANGE_TRIGGER_KEY = "admin_setting_changed";

// FEATURES.md §Module 15: every admin change notifies the other two bishopric members. This
// is a product requirement, not a nicety — call it from every admin route.
export async function notifyOtherBishopric(
  params: NotifyOtherBishopricParams,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const { wardId, actingUserId, description, title } = params;

  try {
    const supabase = client ?? createServiceSupabaseClient();

    const { data, error } = await supabase
      .from("users")
      .select("id")
      .eq("ward_id", wardId)
      .eq("is_active", true)
      .in("role", [...BISHOPRIC_ROLES])
      .neq("id", actingUserId);

    if (error) {
      console.error("Could not resolve the other bishopric members", {
        wardId,
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
        triggerKey: ADMIN_CHANGE_TRIGGER_KEY,
        title: title ?? "Admin setting changed",
        body: description,
        recipientUserIds,
      },
      supabase,
    );
  } catch (error) {
    console.error("notifyOtherBishopric threw", {
      wardId,
      actingUserId,
      error,
    });
  }
}
