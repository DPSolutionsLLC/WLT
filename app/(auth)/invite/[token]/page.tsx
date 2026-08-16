import Link from "next/link";
import { RegisterForm } from "@/app/(auth)/invite/[token]/RegisterForm";
import { Card } from "@/components/ui/Card";
import { INVITE_REFUSED_MESSAGE, readInvitePreview } from "@/lib/auth/invites";

// In the (auth) route group, so it inherits the unauthenticated layout and stays out of the
// middleware redirect — /invite is already in PUBLIC_PATHS.
//
// The preview is read WITHOUT claiming the invite, so an expired or already-used link says so
// before the visitor types a password. Only submitting the form consumes it.
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const preview = await readInvitePreview(token);

  // An unknown token and an expired one get the same answer. Distinguishing them would tell
  // someone probing the URL which tokens exist.
  if (!preview) {
    return (
      <Card>
        <h2 className="text-base font-semibold text-foreground">Invite not valid</h2>
        <p className="mt-2 text-sm text-muted">{INVITE_REFUSED_MESSAGE}</p>
        <Link
          href="/login"
          className="mt-4 inline-block text-sm text-primary underline underline-offset-4"
        >
          Go to sign in
        </Link>
      </Card>
    );
  }

  return (
    <RegisterForm token={token} roleLabel={preview.roleLabel} email={preview.email} />
  );
}
