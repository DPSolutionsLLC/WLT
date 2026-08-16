"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { registerFormSchema } from "@/lib/validation/invite";

export type RegisterFormProps = {
  token: string;
  roleLabel: string;
  email: string | null;
};

type FieldErrors = {
  firstName?: string;
  lastName?: string;
  password?: string;
  confirmPassword?: string;
};

// Naming the invited role is helpful. Offering a way to change it is not — the role on the
// invite row is the only one that decides anything, so a control here could only ever lie.
// There is deliberately no role input, and adding one would not change the account it creates.
export function RegisterForm({ token, roleLabel, email }: RegisterFormProps) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);

    const parsed = registerFormSchema.safeParse({
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

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div>
          <h2 className="text-base font-semibold text-foreground">Set up your account</h2>
          <p className="mt-1 text-sm text-muted">
            You have been invited as <strong className="text-foreground">{roleLabel}</strong>
            {email ? ` for ${email}` : ""}.
          </p>
        </div>

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

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating your account…" : "Create account"}
        </Button>
      </form>
    </Card>
  );
}
