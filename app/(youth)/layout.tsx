import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { YouthSignOut } from "@/app/(youth)/YouthSignOut";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// A separate shell, not the standard nav with items hidden (plans/01-auth-rbac.md §Step 5).
// A hidden nav item is one CSS mistake away from being visible, and the youth account is the
// only account in this app held by someone who is not ward leadership.
//
// This redirect and the mirror check in app/(app)/layout.tsx make the two shells mutually
// exclusive by construction rather than by a filter that has to stay correct.
export default async function YouthLayout({ children }: { children: ReactNode }) {
  const user = await requireSessionUser();

  if (user.role !== "sacrament_manager") redirect("/dashboard");

  const supabase = await createServerSupabaseClient();
  const { data: ward, error } = await supabase
    .from("wards")
    .select("name")
    .eq("id", user.wardId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the ward name for the youth shell — ${error.message}`, {
      wardId: user.wardId,
    });
  }

  const greetingName = user.firstName ?? user.username ?? "Signed in";

  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/* No sidebar, no notification bell, no theme toggle. The root script still applies the
          system theme; there is nothing here to toggle it with. */}
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {ward?.name ?? "Ward Leadership Tools"}
          </p>
          <p className="truncate text-xs text-muted">{greetingName}</p>
        </div>

        <YouthSignOut />
      </header>

      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
