import { redirect } from "next/navigation";
import { NoCallingSignOut } from "@/app/(auth)/no-calling/NoCallingSignOut";
import { getSessionUser, NoCallingError } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// WHERE AN ACCOUNT LANDS WHEN IT HOLDS NO CALLING IN ITS WARD (ITER-058 cr2, plan P11).
//
// The Calling review can release somebody's only calling, and lib/auth/session.ts then has no role
// to give the session. Rather than an error screen, requireSessionUser() sends them here: one plain
// sentence, and a way to sign out. It sits in (auth) because the (app) layout is exactly what
// cannot render for them.
//
// Somebody who does hold a calling (reinstated since, or who typed the address) goes back to the
// dashboard; somebody signed out goes to sign in.

async function readWardName(wardId: string): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("wards").select("name").eq("id", wardId).maybeSingle();

  // A LABEL, so it degrades rather than failing the one page that explains what happened.
  if (error) {
    console.error(`Could not read the ward name for /no-calling — ${error.message}`, { wardId });
    return null;
  }

  return data?.name ?? null;
}

async function readReleasedWardId(): Promise<string | "signed_out" | "has_calling"> {
  try {
    const user = await getSessionUser();
    return user ? "has_calling" : "signed_out";
  } catch (error) {
    if (error instanceof NoCallingError) return error.wardId;
    throw error;
  }
}

export default async function NoCallingPage() {
  const state = await readReleasedWardId();
  if (state === "signed_out") redirect("/login");
  if (state === "has_calling") redirect("/dashboard");

  const wardName = await readWardName(state);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4">
      <p className="text-sm text-foreground">
        You no longer hold a calling in {wardName ?? "this ward"}. If this is a mistake, contact your
        bishopric.
      </p>
      <NoCallingSignOut />
    </div>
  );
}
