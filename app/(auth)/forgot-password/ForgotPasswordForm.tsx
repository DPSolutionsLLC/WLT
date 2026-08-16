"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { forgotPasswordSchema } from "@/lib/validation/auth";

// The same answer whether or not the address exists. A different message for an unknown
// address enumerates accounts just as surely as the login form would.
const SENT_MESSAGE = "If an account exists for that address, a reset link is on its way.";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setEmailError(parsed.error.flatten().fieldErrors.email?.[0]);
      return;
    }

    setEmailError(undefined);
    setIsSubmitting(true);

    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      // Logged, never shown: the user gets the same confirmation either way, but a failure
      // that nobody can see is a failure nobody can fix.
      if (error) {
        console.error("Password reset email could not be sent", { error: error.message });
      }
    } catch (error) {
      console.error("Password reset request threw", error);
    } finally {
      setIsSubmitting(false);
      setIsSent(true);
    }
  }

  if (isSent) {
    return (
      <Card>
        <p className="text-sm text-foreground">{SENT_MESSAGE}</p>
        <Link
          href="/login"
          className="mt-4 inline-block text-sm text-primary underline underline-offset-4"
        >
          Back to sign in
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <p className="text-sm text-muted">
          Enter your email address and we will send you a link to set a new password.
        </p>

        <Input
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={emailError}
          required
        />

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Sending…" : "Send reset link"}
        </Button>

        <Link
          href="/login"
          className="text-center text-sm text-primary underline underline-offset-4"
        >
          Back to sign in
        </Link>
      </form>
    </Card>
  );
}
