"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { loginSchema } from "@/lib/validation/auth";

// Never name the reason. "No account with that email" tells an attacker which addresses are
// worth attacking (01-auth-rbac.md §Step 2).
const CREDENTIALS_MESSAGE = "Email or password is incorrect.";

export type LoginFormProps = {
  redirectTo?: string;
  didResetPassword?: boolean;
  didRegister?: boolean;
};

// redirectTo arrives in a query string, so a caller can put anything in it. Only a same-site
// absolute path is allowed through; "//evil.example" and "https://evil.example" are not.
function safeRedirect(target: string | undefined, fallback: string): string {
  if (!target) return fallback;
  if (!target.startsWith("/") || target.startsWith("//")) return fallback;
  return target;
}

export function LoginForm({
  redirectTo,
  didResetPassword,
  didRegister,
}: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const flattened = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        email: flattened.email?.[0],
        password: flattened.password?.[0],
      });
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      // The browser client exchanges the credentials directly and writes the session cookies
      // the server will read (01-auth-rbac.md §Step 2). Proxying this through a route handler
      // would mean handling the password twice for no gain.
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: parsed.data.email,
        password: parsed.data.password,
      });

      if (error) {
        setFormError(CREDENTIALS_MESSAGE);
        return;
      }

      // The password proved who they are; this proves they are still allowed in, and writes
      // the audit row. A 403 means the server has already signed them back out.
      const response = await fetch("/api/auth/login", { method: "POST" });
      const body: { redirectTo?: string; error?: string } = await response.json();

      if (!response.ok) {
        setFormError(body.error ?? "Could not complete sign-in. Please try again.");
        return;
      }

      router.replace(safeRedirect(redirectTo, body.redirectTo ?? "/dashboard"));
      router.refresh();
    } catch (error) {
      console.error("Sign-in failed", error);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {didResetPassword && (
          <p className="text-sm text-success">
            Your password has been updated. Sign in with it below.
          </p>
        )}

        {didRegister && (
          <p className="text-sm text-success">
            Your account is ready. Sign in with your email and new password.
          </p>
        )}

        <Input
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
          required
        />
        <Input
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
          required
        />

        <FormError message={formError} />

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>

        <Link
          href="/forgot-password"
          className="text-center text-sm text-primary underline underline-offset-4"
        >
          Forgot your password?
        </Link>
      </form>
    </Card>
  );
}
