import type { SupabaseClient } from "@supabase/supabase-js";
import { InvalidInputError } from "@/lib/auth/errors";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

// "EMAIL ME WHEN TOPICS ARE READY OR THE MUSIC IS SENT BACK" — ITER-038 slice mc (plan A5, D1).
//
// ONE TOGGLE, TWO ROWS. The person sees one switch; it is stored as `email_enabled` on their
// `notification_user_prefs` row for EACH of the two triggers, written together, and read as ON only
// when both are on — so a half-written pair reads as off rather than as a promise half kept.
//
// THE PERSON WRITES IT THEMSELVES, through their own client: migration 019's `_own_*` policies
// admit exactly `user_id = auth.uid()`. `is_enabled` (the in-app opt-out) is NEVER touched — an
// upsert that names only `email_enabled` leaves it as it was, and a new row takes its default (on).
//
// ⚠️ KNOWN LIMIT: `notification_user_prefs` is unique on (user_id, trigger_key), NOT per ward
// (migration 013). Somebody with callings in two wards who already has a row written while acting in
// the other ward cannot change it from this one — the row's ward fails this ward's policy and
// Postgres raises 42501. That is reported as a sentence, never a 500. Fixing it properly is a
// migration widening the unique key, and nobody has needed it yet.

export const MUSIC_EMAIL_TRIGGERS = ["music_topics_ready", "music_sent_back"] as const;
export type MusicEmailTrigger = (typeof MUSIC_EMAIL_TRIGGERS)[number];

type Client = SupabaseClient<Database>;

const OTHER_WARD =
  "Your email setting was saved while you were acting in another ward. Switch to that ward to change it.";

export async function readMusicEmailEnabled(
  userId: string,
  wardId: string,
  client: Client,
): Promise<boolean> {
  const { data, error } = await client
    .from("notification_user_prefs")
    .select("trigger_key, email_enabled")
    .eq("user_id", userId)
    .eq("ward_id", wardId)
    .in("trigger_key", [...MUSIC_EMAIL_TRIGGERS]);

  if (error) {
    console.error(`Could not read the music email setting — ${error.message}`, { userId, wardId });
    throw new Error(`Could not read your email setting: ${error.message}`);
  }

  const rows = data ?? [];
  return MUSIC_EMAIL_TRIGGERS.every((trigger) =>
    rows.some((row) => row.trigger_key === trigger && row.email_enabled),
  );
}

export async function writeMusicEmailEnabled(
  userId: string,
  wardId: string,
  enabled: boolean,
  client: Client,
): Promise<boolean> {
  const { error } = await client.from("notification_user_prefs").upsert(
    MUSIC_EMAIL_TRIGGERS.map((trigger) => ({
      ward_id: wardId,
      user_id: userId,
      trigger_key: trigger,
      email_enabled: enabled,
    })),
    { onConflict: "user_id,trigger_key" },
  );

  if (error) {
    if (error.code === "42501") throw new InvalidInputError(OTHER_WARD);
    console.error(`Could not save the music email setting — ${error.message}`, { userId, wardId });
    throw new Error(`Could not save your email setting: ${error.message}`);
  }

  return enabled;
}

// Who, of these people, gets this trigger by EMAIL: switched on, not opted out of the trigger
// altogether, and holding an address. Service role, because the caller is somebody else (the
// conductor finalizing topics) reading the coordinator's preference; only ids and addresses leave.
export async function readEmailRecipients(
  wardId: string,
  userIds: readonly string[],
  triggerKey: MusicEmailTrigger,
): Promise<{ userId: string; email: string }[]> {
  if (userIds.length === 0) return [];

  const { data, error } = await createServiceSupabaseClient()
    .from("notification_user_prefs")
    .select("user_id, users!user_id!inner(email, is_active)")
    .eq("ward_id", wardId)
    .eq("trigger_key", triggerKey)
    .eq("email_enabled", true)
    .eq("is_enabled", true)
    .eq("users.is_active", true)
    .in("user_id", [...userIds]);

  if (error) {
    console.error(`Could not read who wants music email — ${error.message}`, { wardId, triggerKey });
    throw new Error(`Could not read email preferences: ${error.message}`);
  }

  return (data ?? []).flatMap((row) => {
    const email = row.users.email?.trim() ?? "";
    return email === "" ? [] : [{ userId: row.user_id, email }];
  });
}
