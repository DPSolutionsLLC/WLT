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

  const { data, error } = await supabase
    .from("users")
    .select("ward_id, role, is_active")
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

  await writeAuditLog(
    {
      wardId: data.ward_id,
      userId: user.id,
      action: "login",
      module: "auth",
      detail: { role: data.role },
    },
    supabase,
  );

  return NextResponse.json({ redirectTo: "/dashboard" });
}
