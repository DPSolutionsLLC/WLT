import Link from "next/link";
import { PasteImport } from "@/app/(app)/roster/import/PasteImport";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export default async function RosterImportPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

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
        <ol className="mt-2 list-decimal pl-5 text-sm text-muted">
          <li>In LCR, open your ward list report.</li>
          <li>Select the whole table, from the first header to the last row, and copy it.</li>
          <li>Paste it below, then review the changes. Nothing is saved until you apply them.</li>
        </ol>
        <Link
          href="/roster"
          className="mt-2 inline-block text-sm text-primary underline underline-offset-4"
        >
          Back to the roster
        </Link>
      </div>

      <PasteImport />
    </div>
  );
}
