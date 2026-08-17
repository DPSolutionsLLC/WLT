"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { PIN_LENGTH, pinLoginSchema } from "@/lib/validation/youthAccount";

// No on-screen keypad, deliberately — and this is a reversal of what plans/auth-c-youth-pin.md
// §Task 7 specified. Tested on a real phone, inputMode="numeric" already raises the device's
// own numeric keypad, so a second keypad drawn in the page competed with it for the screen and
// got in the way. On a desktop you simply type. The plan assumed the app had to supply the
// keypad; the platform already does.

export function PinSignInForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [usernameError, setUsernameError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    setUsernameError(undefined);

    // pinLoginSchema deliberately applies no PIN format rules — an account whose PIN predates
    // a rule change must still be able to sign in, and a format rejection here would tell an
    // attacker which shapes are worth guessing.
    const parsed = pinLoginSchema.safeParse({ username, pin });
    if (!parsed.success) {
      const flattened = parsed.error.flatten().fieldErrors;
      setUsernameError(flattened.username?.[0]);
      setFormError(flattened.username ? undefined : "Enter your PIN.");
      return;
    }

    setIsSubmitting(true);

    try {
      // Unlike the adult login form, the credential exchange happens on the server. The
      // browser has no way to turn a username into the synthetic address Supabase Auth knows,
      // and putting that mapping in client code would publish it.
      const response = await fetch("/api/auth/pin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const body: { redirectTo?: string; error?: string } = await response.json();

      if (!response.ok) {
        setPin("");
        setFormError(body.error ?? "Could not sign you in. Please try again.");
        return;
      }

      setPin("");
      router.replace(body.redirectTo ?? "/sacrament");
      router.refresh();
    } catch (error) {
      // The PIN is not in this log line and must never be added to it.
      console.error("PIN sign-in request failed", error);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <h2 className="text-base font-semibold text-foreground">Youth sign-in</h2>

        {/* autoCapitalize="off" is load-bearing on iOS: an auto-capitalised first letter
            against a lower-cased username is a sign-in failure with no visible cause. */}
        <Input
          id="pin-username"
          label="Username"
          type="text"
          inputMode="text"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          error={usernameError}
          required
        />

        {/* type="password" so the browser masks the digits — the PIN is never rendered as
            numbers. inputMode="numeric" is what raises the device's numeric keypad. */}
        <Input
          id="pin-value"
          label="PIN"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={PIN_LENGTH}
          value={pin}
          onChange={(event) => {
            setFormError(undefined);
            setPin(event.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH));
          }}
          className="text-center text-2xl tracking-[0.5em]"
          required
        />

        <Button type="submit" disabled={isSubmitting || pin.length === 0}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>

        {/* Not the shared FormError: a lockout message is the one thing on this page a
            distracted teenager has to read, so it is set at body size rather than 14px. */}
        {formError && (
          <p role="alert" className="text-base font-medium text-danger">
            {formError}
          </p>
        )}

        <Link
          href="/login"
          className="text-center text-sm text-primary underline underline-offset-4"
        >
          Ward leader sign-in
        </Link>
      </form>
    </Card>
  );
}
