import Link from "next/link";
import { Card } from "@/components/ui/Card";

// The section index. It exists so the Admin item in NAVIGATION_ITEMS resolves to a real page
// rather than a 404. Ward settings, role access, notification management, and the audit viewer
// join this list in Phase 11 (plans/11-notifications-admin.md).
//
// No permission check here: the layout above already gated the whole section.
const ADMIN_PAGES = [
  {
    href: "/admin/users",
    label: "Users",
    description: "Invite new accounts, change roles, and deactivate accounts.",
  },
];

export default function AdminPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-foreground">Administration</h1>

      <ul className="flex flex-col gap-3">
        {ADMIN_PAGES.map((page) => (
          <li key={page.href}>
            <Card>
              <Link
                href={page.href}
                className="text-sm font-medium text-primary underline underline-offset-4"
              >
                {page.label}
              </Link>
              <p className="mt-1 text-sm text-muted">{page.description}</p>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
