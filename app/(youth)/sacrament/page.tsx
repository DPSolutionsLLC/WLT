import { Card } from "@/components/ui/Card";
import { assertCan } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";

// Deliberately thin, not unfinished. The real assignment grid, the rotation view, and the
// send-message flow are Phase 10 (plans/10-sacrament-admin.md). This exists so a youth
// sign-in has somewhere to land and so the shell isolation can be walked through.
//
// Route-group note for Phase 10: `/sacrament` resolves from app/(youth)/ because (app) and
// (youth) are both groups and contribute nothing to the URL. SPEC.md §Component Structure puts
// the bishopric's `/sacrament/admin` page under the authenticated shell, which cannot coexist
// with this file — a URL belongs to exactly one route group. Phase 10 has to resolve that,
// most likely by addressing the bishopric view as `/admin/sacrament`, which is also how every
// other bishopric-only screen in this app is addressed.
export default async function YouthSacramentPage() {
  const user = await requireSessionUser();

  assertCan(user, "sacrament.view_assignments");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Sacrament assignments</h1>
        <p className="mt-1 text-sm text-muted">
          This is the only part of the app your account can reach.
        </p>
      </div>

      <Card>
        <p className="text-sm text-foreground">
          The monthly assignment list is not built yet. When it is, this is where you will set
          who blesses and passes the sacrament each Sunday, and send the month&rsquo;s
          assignments out.
        </p>
      </Card>
    </div>
  );
}
