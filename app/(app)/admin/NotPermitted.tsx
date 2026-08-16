import Link from "next/link";
import { Card } from "@/components/ui/Card";

export type NotPermittedProps = {
  detail?: string;
};

// A refused page renders this instead of throwing. A ForbiddenError escaping a Server Component
// becomes a 500, and in production Next.js replaces its message with a generic one — so the
// user would see a server fault where the truthful answer is "you are not permitted".
export function NotPermitted({ detail }: NotPermittedProps) {
  return (
    <Card>
      <h1 className="text-base font-semibold text-foreground">Not permitted</h1>
      <p className="mt-2 text-sm text-muted">
        {detail ?? "Your role does not have access to this page."} If you think that is wrong,
        ask a member of the bishopric.
      </p>
      <Link
        href="/dashboard"
        className="mt-4 inline-block text-sm text-primary underline underline-offset-4"
      >
        Back to the dashboard
      </Link>
    </Card>
  );
}
