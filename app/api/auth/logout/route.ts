import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { getSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Audit first, sign out second. Reversed, writeAuditLog would insert through a client with no
// session and the audit_log insert policy (user_id = auth.uid()) would reject it. writeAuditLog
// never throws, so that failure would be a silent hole in the trail — exactly what CLAUDE.md
// rule 6 forbids.
export async function POST() {
  const supabase = await createServerSupabaseClient();
  const user = await getSessionUser(supabase);

  if (user) {
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "logout",
        module: "auth",
      },
      supabase,
    );
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Sign-out failed", { userId: user?.id, error: error.message });
    return NextResponse.json(
      { error: "Could not sign you out. Please try again." },
      { status: 500 },
    );
  }

  // Signing out with no session is not an error — the user wanted to be signed out and is.
  return NextResponse.json({ redirectTo: "/login" });
}
