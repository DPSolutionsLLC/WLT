import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// This is NOT credential exchange — the browser client already did that (01-auth-rbac.md
// §Step 2). This route runs the checks that must not live in the browser: that the account
// still exists, that it is still active, and that the sign-in is recorded.
//
// It accepts no body, deliberately. Anything a client could send is either already in the
// session cookie or is something it must not be allowed to assert.

const DEACTIVATED_MESSAGE =
  "This account has been deactivated. Contact a member of the bishopric.";

export async function POST() {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "You are not signed in. Please try again." },
      { status: 401 },
    );
  }

  // `role` IS NOT SELECTED HERE. It belongs to the calling in the ward being acted in (migration
  // 070), not to the account, and migration 071 drops the column — a select naming it would be a
  // 400 on every sign-in. The audit detail below takes it from session_context() instead, which
  // is the same answer RLS reads.
  const { data, error } = await supabase
    .from("users")
    .select("ward_id, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Could not read the users row during sign-in verification", {
      userId: user.id,
      error: error.message,
    });
    return NextResponse.json(
      { error: "Could not complete sign-in. Please try again." },
      { status: 500 },
    );
  }

  // No row at all is a half-created account: an auth.users row whose public.users row never
  // landed. It gets the same answer as a deactivated one — the user can do nothing about
  // either, and the distinction is only useful to an attacker.
  if (!data) {
    console.error("Signed-in auth user has no public.users row", { userId: user.id });
  }

  if (!data || !data.is_active) {
    // Sign out before answering, so a refused user is not left holding a valid cookie.
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      console.error("Could not sign out a refused account", {
        userId: user.id,
        error: signOutError.message,
      });
    }

    return NextResponse.json({ error: DEACTIVATED_MESSAGE }, { status: 403 });
  }

  // THE AUDIT ROW IS FILED UNDER THE WARD THE SESSION IS ACTING IN, NOT THE HOME WARD, and that
  // is not cosmetic. `audit_log_insert` (migration 019) is `ward_id = current_ward_id() and …`,
  // so a row carrying `users.ward_id` for somebody whose `active_ward_id` is still set from a
  // previous session is REFUSED — and writeAuditLog never throws, because an audit failure must
  // not fail the user's action. The sign-in would simply go unrecorded, silently, for exactly the
  // sessions most worth recording. Migration 067's header describes the same defect on the same
  // table, found the same way.
  //
  // It also supplies the role for the detail, from the same round trip, so the trail names the
  // calling they signed in under rather than a column that no longer exists.
  const { data: contextRows, error: contextError } = await supabase.rpc("session_context");

  if (contextError) {
    console.error("Could not read the session context during sign-in verification", {
      userId: user.id,
      error: contextError.message,
    });
  }

  const context = contextRows?.[0];

  await writeAuditLog(
    {
      wardId: context?.ward_id ?? data.ward_id,
      userId: user.id,
      action: "login",
      module: "auth",
      detail: { role: context?.role ?? null },
    },
    supabase,
  );

  return NextResponse.json({ redirectTo: "/dashboard" });
}
