import Link from "next/link";
import { ImportWizard } from "@/app/(app)/roster/import/ImportWizard";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function RosterImportPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  // can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500
  // whose message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
  if (!can(user, "roster.import", roleAccess)) {
    return (
      <NotPermitted detail="Importing the ward roster is limited to the bishopric." />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Import the roster</h1>
        <p className="mt-1 text-sm text-muted">
          Three steps — choose a file, match the columns, then check the preview and confirm.
        </p>
        <Link
          href="/roster"
          className="mt-2 inline-block text-sm text-primary underline underline-offset-4"
        >
          Back to the roster
        </Link>
      </div>

      <ImportWizard />
    </div>
  );
}
