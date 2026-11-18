import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { getSessionUser, NoCallingError } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

// An account whose calling was just released (ITER-058 cr2) must still be able to sign out, and
// the sign-out is still audited — under the ward its session resolved to, which NoCallingError
// carries.
async function readAuditTarget(
  supabase: ServerClient,
): Promise<{ userId: string; wardId: string } | null> {
  try {
    const user = await getSessionUser(supabase);
    return user ? { userId: user.id, wardId: user.wardId } : null;
  } catch (error) {
    if (error instanceof NoCallingError) return { userId: error.userId, wardId: error.wardId };
    throw error;
  }
}

// Audit first, sign out second. Reversed, writeAuditLog would insert through a client with no
// session and the audit_log insert policy (user_id = auth.uid()) would reject it. writeAuditLog
// never throws, so that failure would be a silent hole in the trail — exactly what CLAUDE.md
// rule 6 forbids.
export async function POST() {
  const supabase = await createServerSupabaseClient();
  const auditTarget = await readAuditTarget(supabase);

  if (auditTarget) {
    await writeAuditLog(
      {
        wardId: auditTarget.wardId,
        userId: auditTarget.userId,
        action: "logout",
        module: "auth",
      },
      supabase,
    );
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Sign-out failed", { userId: auditTarget?.userId, error: error.message });
    return NextResponse.json(
      { error: "Could not sign you out. Please try again." },
      { status: 500 },
    );
  }

  // Signing out with no session is not an error — the user wanted to be signed out and is.
  return NextResponse.json({ redirectTo: "/login" });
}
