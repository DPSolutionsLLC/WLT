import Link from "next/link";
import { RegisterForm } from "@/app/(auth)/invite/[token]/RegisterForm";
import { Card } from "@/components/ui/Card";
import {
  INVITE_CALLING_CHANGED_MESSAGE,
  INVITE_REFUSED_MESSAGE,
  readInvitePreview,
} from "@/lib/auth/invites";

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

  // The roster no longer gives this person a calling the app recognises (ITER-058 cr4). Said
  // before a password is typed, rather than after the form is sent.
  if (preview.kind === "calling_changed") {
    return (
      <Card>
        <h2 className="text-base font-semibold text-foreground">Invite out of date</h2>
        <p className="mt-2 text-sm text-muted">{INVITE_CALLING_CHANGED_MESSAGE}</p>
        <Link
          href="/login"
          className="mt-4 inline-block text-sm text-primary underline underline-offset-4"
        >
          Go to sign in
        </Link>
      </Card>
    );
  }

  return preview.kind === "member" ? (
    <RegisterForm
      token={token}
      email={preview.email}
      invitedAs={{ kind: "member", memberName: preview.memberName, callingLabel: preview.callingLabel }}
    />
  ) : (
    <RegisterForm
      token={token}
      email={preview.email}
      invitedAs={{ kind: "role", roleLabel: preview.roleLabel }}
    />
  );
}
