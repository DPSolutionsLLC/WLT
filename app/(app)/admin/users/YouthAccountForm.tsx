"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import type { YouthAccountListEntry } from "@/lib/auth/youthAccounts";
import {
  PIN_LENGTH,
  createYouthAccountFormSchema,
  resetPinFormSchema,
} from "@/lib/validation/youthAccount";

export type YouthAccountFormProps = {
  accounts: YouthAccountListEntry[];
};

// The PIN exists in this component's state and nowhere else. It is never written to
// localStorage, never put in a URL, and never sent back by the server — once this page is
// left, the only way to recover it is another reset.
type RevealedCredential = {
  username: string;
  pin: string;
  isReset: boolean;
};

type FieldErrors = {
  username?: string;
  firstName?: string;
  lastName?: string;
  pin?: string;
  confirmPin?: string;
};

function fullName(account: YouthAccountListEntry): string {
  return [account.firstName, account.lastName].filter(Boolean).join(" ").trim();
}

export function YouthAccountForm({ accounts }: YouthAccountFormProps) {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [revealed, setRevealed] = useState<RevealedCredential>();

  const [resettingUserId, setResettingUserId] = useState<string>();
  const [resetPin, setResetPin] = useState("");
  const [resetConfirmPin, setResetConfirmPin] = useState("");
  const [resetErrors, setResetErrors] = useState<FieldErrors>({});
  const [resetError, setResetError] = useState<string>();

  function closeResetForm() {
    setResettingUserId(undefined);
    setResetPin("");
    setResetConfirmPin("");
    setResetErrors({});
    setResetError(undefined);
  }

  // Only one reset form is open at a time, and switching rows clears the fields rather than
  // carrying a half-typed PIN across to a different account.
  function toggleResetForm(accountId: string) {
    const wasOpen = resettingUserId === accountId;
    closeResetForm();
    if (!wasOpen) setResettingUserId(accountId);
  }

  // Validated client-side with the same schema the route parses, so the PIN rules are stated
  // before submission rather than after (conventions.md §Validation).
  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    setRevealed(undefined);

    const parsed = createYouthAccountFormSchema.safeParse({
      username,
      firstName,
      lastName,
      pin,
      confirmPin,
    });

    if (!parsed.success) {
      const flattened = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        username: flattened.username?.[0],
        firstName: flattened.firstName?.[0],
        lastName: flattened.lastName?.[0],
        pin: flattened.pin?.[0],
        confirmPin: flattened.confirmPin?.[0],
      });
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/admin/users/youth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: parsed.data.username,
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          pin: parsed.data.pin,
        }),
      });

      const body: { error?: string } = await response.json();

      if (!response.ok) {
        setFormError(body.error ?? "Could not create the account. Please try again.");
        return;
      }

      setRevealed({ username: parsed.data.username, pin: parsed.data.pin, isReset: false });
      setUsername("");
      setFirstName("");
      setLastName("");
      setPin("");
      setConfirmPin("");
      router.refresh();
    } catch (error) {
      // The PIN is not in this log line and must never be added to it (CLAUDE.md rule 8).
      console.error("Could not create the youth account", error);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReset(event: FormEvent<HTMLFormElement>, account: YouthAccountListEntry) {
    event.preventDefault();
    setResetError(undefined);
    setRevealed(undefined);

    const parsed = resetPinFormSchema.safeParse({
      pin: resetPin,
      confirmPin: resetConfirmPin,
    });

    if (!parsed.success) {
      const flattened = parsed.error.flatten().fieldErrors;
      setResetErrors({
        pin: flattened.pin?.[0],
        confirmPin: flattened.confirmPin?.[0],
      });
      return;
    }

    setResetErrors({});
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/users/${account.id}/reset-pin`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: parsed.data.pin }),
      });

      const body: { error?: string } = await response.json();

      if (!response.ok) {
        setResetError(body.error ?? "Could not reset the PIN. Please try again.");
        return;
      }

      setRevealed({ username: account.username, pin: parsed.data.pin, isReset: true });
      closeResetForm();
      router.refresh();
    } catch (error) {
      console.error("Could not reset the PIN", { userId: account.id, error });
      setResetError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Youth accounts</h2>
          <p className="mt-1 text-sm text-muted">
            Sign in with a username and PIN. No email address, and no way to reset a PIN
            without you.
          </p>
        </div>

        {revealed && (
          <div className="rounded-md border border-primary bg-surface p-3">
            <p className="text-sm font-medium text-foreground">
              {revealed.isReset ? "New PIN set" : "Account created"}
            </p>
            <p className="mt-2 text-sm text-foreground">
              Username <span className="font-mono font-semibold">{revealed.username}</span>
              {" · "}
              PIN <span className="font-mono font-semibold">{revealed.pin}</span>
            </p>
            <p className="mt-2 text-sm text-muted">
              Write this down — it cannot be retrieved. Leaving this page is the end of it, and
              the only way back is another reset.
            </p>
          </div>
        )}

        <form onSubmit={handleCreate} className="flex flex-col gap-4" noValidate>
          <Input
            id="youth-username"
            label="Username"
            type="text"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            error={fieldErrors.username}
            required
          />

          <div className="flex flex-col gap-4 md:flex-row">
            <div className="flex-1">
              <Input
                id="youth-first-name"
                label="First name"
                type="text"
                autoComplete="off"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                error={fieldErrors.firstName}
                required
              />
            </div>
            <div className="flex-1">
              <Input
                id="youth-last-name"
                label="Last name"
                type="text"
                autoComplete="off"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                error={fieldErrors.lastName}
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-4 md:flex-row">
            <div className="flex-1">
              <Input
                id="youth-pin"
                label="PIN (6 digits)"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={PIN_LENGTH}
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                error={fieldErrors.pin}
                required
              />
            </div>
            <div className="flex-1">
              <Input
                id="youth-confirm-pin"
                label="Confirm PIN"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={PIN_LENGTH}
                value={confirmPin}
                onChange={(event) => setConfirmPin(event.target.value)}
                error={fieldErrors.confirmPin}
                required
              />
            </div>
          </div>

          <FormError message={formError} />

          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Creating the account…" : "Create youth account"}
          </Button>
        </form>

        {/* A separate list from the adult table above. Youth accounts have no email and no
            invite, so folding them into one table makes both harder to read. */}
        {accounts.length === 0 ? (
          <p className="text-sm text-muted">No youth accounts in this ward yet.</p>
        ) : (
          <ul className="flex flex-col gap-3 border-t border-border pt-4">
            {accounts.map((account) => (
              <li
                key={account.id}
                className="rounded-lg border border-border bg-surface p-3"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {fullName(account) || account.username}
                      {!account.isActive && (
                        <span className="ml-2 text-xs text-muted">(deactivated)</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted">{account.username}</p>
                  </div>

                  <Button
                    variant="secondary"
                    disabled={isSubmitting}
                    onClick={() => toggleResetForm(account.id)}
                  >
                    {resettingUserId === account.id ? "Cancel" : "Reset PIN"}
                  </Button>
                </div>

                {resettingUserId === account.id && (
                  <form
                    onSubmit={(event) => handleReset(event, account)}
                    className="mt-3 flex flex-col gap-3 border-t border-border pt-3"
                    noValidate
                  >
                    <Input
                      id={`reset-pin-${account.id}`}
                      label="New PIN (6 digits)"
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={PIN_LENGTH}
                      value={resetPin}
                      onChange={(event) => setResetPin(event.target.value)}
                      error={resetErrors.pin}
                      required
                    />
                    <Input
                      id={`reset-confirm-pin-${account.id}`}
                      label="Confirm new PIN"
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={PIN_LENGTH}
                      value={resetConfirmPin}
                      onChange={(event) => setResetConfirmPin(event.target.value)}
                      error={resetErrors.confirmPin}
                      required
                    />

                    <FormError message={resetError} />

                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting ? "Setting the PIN…" : "Set new PIN"}
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
