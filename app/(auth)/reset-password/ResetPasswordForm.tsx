"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { resetPasswordSchema } from "@/lib/validation/auth";

const EXPIRED_MESSAGE = "This reset link has expired. Request a new one.";

type RecoveryState = "checking" | "ready" | "expired";

export function ResetPasswordForm() {
  const router = useRouter();
  const [recoveryState, setRecoveryState] = useState<RecoveryState>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    password?: string;
    confirmPassword?: string;
  }>({});
  const [formError, setFormError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Following the emailed link puts a recovery session in place before this page renders. No
  // session means the link was already used, or it expired.
  useEffect(() => {
    let isMounted = true;

    async function checkRecoverySession() {
      const supabase = createBrowserSupabaseClient();
      const { data, error } = await supabase.auth.getSession();

      if (!isMounted) return;

      if (error) {
        console.error("Could not read the recovery session", { error: error.message });
      }

      setRecoveryState(data.session ? "ready" : "expired");
    }

    void checkRecoverySession();

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);

    const parsed = resetPasswordSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) {
      const flattened = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        password: flattened.password?.[0],
        confirmPassword: flattened.confirmPassword?.[0],
      });
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

      if (error) {
        console.error("Password update rejected", { error: error.message });
        setFormError("Could not set the new password. Request a fresh reset link and retry.");
        return;
      }

      // Sign the recovery session out before leaving. It is a real session, so /login would
      // otherwise bounce straight to /dashboard and the confirmation would never be seen —
      // and a fresh sign-in is the only proof the new password actually works.
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        console.error("Could not end the recovery session", {
          error: signOutError.message,
        });
      }

      router.replace("/login?reset=1");
    } catch (error) {
      console.error("Password update threw", error);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (recoveryState === "checking") {
    return (
      <Card>
        <p className="text-sm text-muted">Checking your reset link…</p>
      </Card>
    );
  }

  if (recoveryState === "expired") {
    return (
      <Card>
        <p className="text-sm text-foreground">{EXPIRED_MESSAGE}</p>
        <Link
          href="/forgot-password"
          className="mt-4 inline-block text-sm text-primary underline underline-offset-4"
        >
          Request a new reset link
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input
          id="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
          required
        />
        <Input
          id="confirmPassword"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          error={fieldErrors.confirmPassword}
          required
        />

        <FormError message={formError} />

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Set new password"}
        </Button>
      </form>
    </Card>
  );
}
