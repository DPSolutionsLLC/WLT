import { addMinutes, differenceInMinutes } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PinLockedError } from "@/lib/auth/errors";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

// `youth_login_attempts` has RLS enabled and no policies (migration 021), so every function
// here defaults to the service-role client. The caller of a PIN sign-in is unauthenticated by
// definition — there is no session for a policy to evaluate.
//
// Nothing in this file ever receives or records a PIN. It counts failures against a username.

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

type AttemptRow = {
  id: string;
  failed_count: number;
  locked_until: string | null;
};

function normalise(username: string): string {
  return username.toLowerCase();
}

async function readAttempt(
  supabase: SupabaseClient<Database>,
  wardId: string,
  username: string,
): Promise<AttemptRow | null> {
  const { data, error } = await supabase
    .from("youth_login_attempts")
    .select("id, failed_count, locked_until")
    .eq("ward_id", wardId)
    .eq("username", normalise(username))
    .maybeSingle();

  if (error) {
    console.error(
      `Could not read youth login attempts — ${error.message}`,
      { wardId, username: normalise(username) },
    );
    throw new Error(`Could not read the sign-in attempt record: ${error.message}`);
  }

  return data;
}

// Rounded up so "locked for another 40 seconds" reads as "1 minute" rather than "0 minutes",
// which would look like a bug to the person staring at it.
function remainingMinutes(lockedUntil: Date, now: Date): number {
  return Math.max(1, differenceInMinutes(lockedUntil, now) + 1);
}

export async function assertNotLocked(
  wardId: string,
  username: string,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const supabase = client ?? createServiceSupabaseClient();
  const attempt = await readAttempt(supabase, wardId, username);

  if (!attempt?.locked_until) return;

  const now = new Date();
  const lockedUntil = new Date(attempt.locked_until);

  // A lock whose window has passed is not a lock. recordFailedAttempt() is what clears the
  // counter; this only declines to throw, so a stale row never blocks a correct PIN.
  if (lockedUntil <= now) return;

  throw new PinLockedError(remainingMinutes(lockedUntil, now));
}

export async function recordFailedAttempt(
  wardId: string,
  username: string,
  client?: SupabaseClient<Database>,
): Promise<{ isNowLocked: boolean }> {
  const supabase = client ?? createServiceSupabaseClient();
  const normalised = normalise(username);
  const now = new Date();

  const attempt = await readAttempt(supabase, wardId, normalised);

  // A lock that has expired restarts the count at 1 rather than resuming at 6, so the window
  // is genuinely rolling. Without this the sixth failure of all time would re-lock instantly.
  const hasExpiredLock =
    attempt?.locked_until !== null &&
    attempt?.locked_until !== undefined &&
    new Date(attempt.locked_until) <= now;

  const previousCount = !attempt || hasExpiredLock ? 0 : attempt.failed_count;
  const failedCount = previousCount + 1;
  const isNowLocked = failedCount >= MAX_FAILED_ATTEMPTS;

  const { error } = await supabase.from("youth_login_attempts").upsert(
    {
      ward_id: wardId,
      username: normalised,
      failed_count: failedCount,
      locked_until: isNowLocked
        ? addMinutes(now, LOCKOUT_MINUTES).toISOString()
        : null,
      last_failed_at: now.toISOString(),
    },
    { onConflict: "ward_id,username" },
  );

  if (error) {
    console.error(
      `Could not record a failed PIN attempt — ${error.message}`,
      { wardId, username: normalised },
    );
    throw new Error(`Could not record the sign-in attempt: ${error.message}`);
  }

  return { isNowLocked };
}

// "Five *consecutive* failures" — the counter resets on a success, it does not accumulate for
// the life of the account. Called on every successful sign-in and on an admin PIN reset.
export async function clearAttempts(
  wardId: string,
  username: string,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const supabase = client ?? createServiceSupabaseClient();

  const { error } = await supabase
    .from("youth_login_attempts")
    .delete()
    .eq("ward_id", wardId)
    .eq("username", normalise(username));

  if (error) {
    console.error(
      `Could not clear youth login attempts — ${error.message}`,
      { wardId, username: normalise(username) },
    );
    throw new Error(`Could not clear the sign-in attempts: ${error.message}`);
  }
}
