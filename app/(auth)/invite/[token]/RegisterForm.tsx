"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { registerFormSchema } from "@/lib/validation/invite";

// Who the invite says this is. A person invite (ITER-058 cr4) names somebody on the ward list and
// the calling the roster gives them; an invite made before cr4 names only a role.
export type InvitedAs =
  | { kind: "member"; memberName: string; callingLabel: string }
  | { kind: "role"; roleLabel: string };

export type RegisterFormProps = {
  token: string;
  email: string | null;
  invitedAs: InvitedAs;
};

type FieldErrors = {
  confirmedIdentity?: string;
  firstName?: string;
  lastName?: string;
  password?: string;
  confirmPassword?: string;
};

// Naming the invited calling is helpful. Offering a way to change it is not — the invite row and
// the roster person it names are the only things that decide anything, so a control here could only
// ever lie. There is deliberately no role input, and adding one would not change the account it
// creates.
//
// "YES, THIS IS ME" IS REQUIRED ON A PERSON INVITE. The registrant never picks a record; they only
// confirm the one the bishopric chose.
//
// "NO, THIS ISN'T ME" ASKS ONCE, THEN ENDS THE LINK (decided walking scenario 105). The confirmation
// is in the page (the browser's confirm() is not used). Confirming posts to /api/auth/invite/not-me,
// which cancels the link and tells whoever sent it; the form is then replaced, so nobody is left
// looking at a "Create account" button for an invite that no longer works.
export function RegisterForm({ token, email, invitedAs }: RegisterFormProps) {
  const isPersonInvite = invitedAs.kind === "member";
  const [confirmedIdentity, setConfirmedIdentity] = useState(false);
  const [notMeStep, setNotMeStep] = useState<"idle" | "confirming" | "sending" | "done">("idle");
  const [notMeError, setNotMeError] = useState<string>();
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function sendNotMe() {
    setNotMeError(undefined);
    setNotMeStep("sending");

    try {
      const response = await fetch("/api/auth/invite/not-me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        const body: { error?: string } = await response.json();
        setNotMeError(body.error ?? "Could not send your answer. Please try again.");
        setNotMeStep("confirming");
        return;
      }

      setNotMeStep("done");
    } catch (error) {
      console.error("Could not send \"not me\" for an invite", {
        error: error instanceof Error ? error.message : String(error),
      });
      setNotMeError("Could not reach the server. Check your connection and try again.");
      setNotMeStep("confirming");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);

    if (isPersonInvite && !confirmedIdentity) {
      setFieldErrors({ confirmedIdentity: 'Tick "Yes, this is me" to continue.' });
      return;
    }

    const parsed = registerFormSchema.safeParse({
      ...(isPersonInvite ? { confirmedIdentity: true } : {}),
      firstName,
      lastName,
      password,
      confirmPassword,
    });

    if (!parsed.success) {
      const flattened = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        firstName: flattened.firstName?.[0],
        lastName: flattened.lastName?.[0],
        password: flattened.password?.[0],
        confirmPassword: flattened.confirmPassword?.[0],
      });
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          ...(isPersonInvite ? { confirmedIdentity: true } : {}),
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          password: parsed.data.password,
        }),
      });

      const body: { redirectTo?: string; error?: string } = await response.json();

      if (!response.ok) {
        setFormError(body.error ?? "Could not create the account. Please try again.");
        return;
      }

      router.replace(body.redirectTo ?? "/login?registered=1");
    } catch (error) {
      console.error("Registration failed", error);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (notMeStep === "done") {
    return (
      <Card>
        <div role="status" className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-foreground">Thanks for letting us know</h2>
          <p className="text-sm text-muted">
            We&apos;ve told the person who sent this invite. This link no longer works, and you can close
            this page.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div>
          <h2 className="text-base font-semibold text-foreground">Set up your account</h2>
          {invitedAs.kind === "member" ? (
            <p className="mt-1 text-sm text-muted">
              You&apos;re invited as <strong className="text-foreground">{invitedAs.memberName}</strong>,{" "}
              <strong className="text-foreground">{invitedAs.callingLabel}</strong>
              {email ? ` for ${email}` : ""}.
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">
              You have been invited as <strong className="text-foreground">{invitedAs.roleLabel}</strong>
              {email ? ` for ${email}` : ""}.
            </p>
          )}
        </div>

        {invitedAs.kind === "member" && (
          <div className="flex flex-col gap-2">
            <label className="flex min-h-11 items-center gap-3 text-sm text-foreground">
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-primary"
                checked={confirmedIdentity}
                onChange={(event) => {
                  setConfirmedIdentity(event.target.checked);
                  setNotMeStep("idle");
                  setNotMeError(undefined);
                  setFieldErrors((previous) => ({ ...previous, confirmedIdentity: undefined }));
                }}
                aria-describedby={fieldErrors.confirmedIdentity ? "confirmedIdentity-error" : undefined}
              />
              Yes, this is me
            </label>
            {fieldErrors.confirmedIdentity && (
              <p id="confirmedIdentity-error" className="text-sm text-danger">
                {fieldErrors.confirmedIdentity}
              </p>
            )}
            {notMeStep === "idle" ? (
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setNotMeStep("confirming");
                    setConfirmedIdentity(false);
                    setFieldErrors((previous) => ({ ...previous, confirmedIdentity: undefined }));
                  }}
                >
                  No, this isn&apos;t me
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3">
                <p className="text-sm text-foreground">
                  This invite is for {invitedAs.memberName}. If that isn&apos;t you, we&apos;ll cancel this
                  link and tell the person who sent it, so they can check the email address.
                </p>
                <FormError message={notMeError} />
                <div className="flex flex-col gap-2 md:flex-row">
                  <Button type="button" disabled={notMeStep === "sending"} onClick={() => void sendNotMe()}>
                    {notMeStep === "sending" ? "Sending…" : "It isn’t me, cancel this link"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={notMeStep === "sending"}
                    onClick={() => {
                      setNotMeStep("idle");
                      setNotMeError(undefined);
                    }}
                  >
                    Go back
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <Input
          id="firstName"
          label="First name"
          autoComplete="given-name"
          value={firstName}
          onChange={(event) => setFirstName(event.target.value)}
          error={fieldErrors.firstName}
          required
        />
        <Input
          id="lastName"
          label="Last name"
          autoComplete="family-name"
          value={lastName}
          onChange={(event) => setLastName(event.target.value)}
          error={fieldErrors.lastName}
          required
        />
        <Input
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
          required
        />
        <Input
          id="confirmPassword"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          error={fieldErrors.confirmPassword}
          required
        />

        <FormError message={formError} />

        <Button type="submit" disabled={isSubmitting || notMeStep !== "idle"}>
          {isSubmitting ? "Creating your account…" : "Create account"}
        </Button>
      </form>
    </Card>
  );
}
