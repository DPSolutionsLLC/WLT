import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import {
  LOCKOUT_MINUTES,
  assertNotLocked,
  clearAttempts,
  recordFailedAttempt,
} from "@/lib/auth/pinLockout";
import {
  pinLockedMessage,
  readJsonBody,
  respondToRouteError,
} from "@/lib/auth/routeErrors";
import { syntheticYouthEmail } from "@/lib/auth/syntheticYouthEmail";
import { emitNotification } from "@/lib/notifications/emitNotification";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { pinLoginSchema } from "@/lib/validation/youthAccount";

// Public by design: no requireSessionUser, no assertCan. It is the only unauthenticated write
// path in Phase 1, which is why the rate limiting in lib/auth/pinLockout.ts is part of the
// feature rather than a hardening pass afterwards. A 6-digit PIN is 1,000,000 possibilities,
// which is only safe to type on a phone because guessing stops after five tries.
//
// THE PIN IS NEVER LOGGED. Not on the success path, not in a catch block, not in a Zod error.
// Every log line here carries { username, wardId } and nothing else. A PIN in a Vercel log is
// a real leak with no way to unwind it (plans/01-auth-rbac.md §Pitfalls, CLAUDE.md rule 8).

// One answer for an unknown username, a wrong PIN, and a deactivated account. Telling them
// apart turns one guessing problem into two easier ones: find a real username first, then
// guess the PIN against it.
const CREDENTIALS_MESSAGE = "That username or PIN is not correct.";

const LOCKED_TRIGGER_KEY = "youth_account_locked";

export async function POST(request: Request) {
  const service = createServiceSupabaseClient();

  // Declared out here so the catch block can record the failure context without re-parsing.
  let username: string | undefined;
  let wardId: string | undefined;

  try {
    const parsed = pinLoginSchema.parse(await readJsonBody(request));
    username = parsed.username;
    const { pin } = parsed;

    // Resolved with the service client across every ward: the caller has no session, so there
    // is nothing for a policy to scope by, and the sign-in form has no ward field. v1 is
    // single-ward (plans/INDEX.md §Scope Guardrails).
    const { data: candidates, error: lookupError } = await service
      .from("users")
      .select("id, ward_id, username, is_active")
      .eq("username", username)
      .not("username", "is", null);

    if (lookupError) {
      console.error(
        `Could not resolve a username for PIN sign-in — ${lookupError.message}`,
        { username },
      );
      throw new Error(`Could not resolve the username: ${lookupError.message}`);
    }

    // More than one match means the single-ward assumption has broken, which is a deployment
    // problem rather than a user's problem. Refusing is the safe answer — signing them into
    // one of two wards arbitrarily is worse than refusing — but it must be loud in the log,
    // because nothing else in the app would ever surface it.
    if ((candidates ?? []).length > 1) {
      console.warn(
        `Username "${username}" resolves to more than one ward. PIN sign-in refused. ` +
          "Multi-ward PIN login needs a ward field on the form (plans/INDEX.md §Scope Guardrails).",
      );
      return NextResponse.json({ error: CREDENTIALS_MESSAGE }, { status: 401 });
    }

    const account = candidates?.[0];

    // An unknown username still records nothing here — the attempt is recorded below against
    // whichever ward we can attribute it to. With no match there is no ward to attribute it
    // to at all, so the answer is the generic one and the counter is untouched. That is the
    // accepted limit of the anti-enumeration property: the response is identical either way,
    // which is what an attacker can actually observe.
    if (!account || !account.is_active) {
      return NextResponse.json({ error: CREDENTIALS_MESSAGE }, { status: 401 });
    }

    wardId = account.ward_id;

    // Throws PinLockedError, which respondToRouteError turns into a 429 carrying the minutes
    // remaining. Checked BEFORE the password exchange so a locked account cannot be probed by
    // timing the Supabase call.
    await assertNotLocked(wardId, username, service);

    // The SERVER client, not the service client, and this is the reason two clients appear in
    // one handler: @supabase/ssr writes the session cookies onto the outgoing response, which
    // is the whole point of the exchange. The service client cannot issue a user session.
    const supabase = await createServerSupabaseClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: syntheticYouthEmail(username, wardId),
      password: pin,
    });

    if (signInError) {
      const { isNowLocked } = await recordFailedAttempt(wardId, username, service);

      if (isNowLocked) {
        console.warn(`Youth account "${username}" locked after repeated failures`, {
          wardId,
        });

        await emitNotification(
          {
            wardId,
            triggerKey: LOCKED_TRIGGER_KEY,
            title: "Youth account locked",
            body:
              `The youth account "${username}" was locked after five failed PIN attempts. ` +
              "Reset its PIN from Admin → Users to unlock it immediately.",
          },
          service,
        );

        // The attempt that trips the lock says so, rather than giving the generic message and
        // leaving the next correct PIN to fail for no visible reason. This leaks nothing: an
        // unknown username returned above without ever reaching recordFailedAttempt, so by
        // here the account is already known to exist — which the 429 on the NEXT attempt would
        // reveal anyway.
        return NextResponse.json(
          { error: pinLockedMessage(LOCKOUT_MINUTES) },
          { status: 429 },
        );
      }

      return NextResponse.json({ error: CREDENTIALS_MESSAGE }, { status: 401 });
    }

    await clearAttempts(wardId, username, service);

    // Written through the now-authenticated server client, so the audit_log insert policy
    // (user_id = auth.uid()) is satisfied by a real session rather than bypassed.
    await writeAuditLog(
      {
        wardId,
        userId: account.id,
        action: "login",
        module: "auth",
        detail: { role: "sacrament_manager", method: "pin" },
      },
      supabase,
    );

    return NextResponse.json({ redirectTo: "/sacrament" });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/auth/pin-login",
      fallbackMessage: "Could not sign you in. Please try again.",
      detail: { username, wardId },
    });
  }
}
