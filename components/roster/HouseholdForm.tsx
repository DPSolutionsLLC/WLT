"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import type { Household } from "@/lib/roster/queries";
import { createHouseholdSchema } from "@/lib/validation/roster";

export type HouseholdFormProps = {
  household?: Household;
  onSaved?: (household: Household) => void;
};

// Validates with the same schema the route parses (conventions.md §Validation). If the two
// diverge the form accepts something the server rejects, and the user gets a failure with no
// field to fix.
export function HouseholdForm({ household, onSaved }: HouseholdFormProps) {
  const router = useRouter();
  const isEditing = household !== undefined;

  const [familyName, setFamilyName] = useState(household?.familyName ?? "");
  const [address, setAddress] = useState(household?.address ?? "");
  const [doNotContact, setDoNotContact] = useState(household?.doNotContact ?? false);
  const [familyNameError, setFamilyNameError] = useState<string>();
  const [addressError, setAddressError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [statusMessage, setStatusMessage] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    setFamilyNameError(undefined);
    setAddressError(undefined);
    setStatusMessage(undefined);

    const parsed = createHouseholdSchema.safeParse({
      familyName,
      address: address.trim() === "" ? null : address,
      doNotContact,
    });

    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      setFamilyNameError(fieldErrors.familyName?.[0]);
      setAddressError(fieldErrors.address?.[0]);
      if (!fieldErrors.familyName && !fieldErrors.address) {
        setFormError("Check the form and try again.");
      }
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(
        isEditing ? `/api/households/${household.id}` : "/api/households",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );

      const body: { household?: Household; error?: string } = await response.json();

      if (!response.ok || !body.household) {
        setFormError(body.error ?? "Could not save the household. Please try again.");
        return;
      }

      setStatusMessage(isEditing ? "Saved." : `Added ${body.household.familyName}.`);

      if (!isEditing) {
        setFamilyName("");
        setAddress("");
        setDoNotContact(false);
      }

      onSaved?.(body.household);
      router.refresh();
    } catch (error) {
      console.error("Could not save the household", error);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <Input
        id="household-family-name"
        label="Family name"
        value={familyName}
        onChange={(event) => setFamilyName(event.target.value)}
        error={familyNameError}
        autoComplete="off"
        required
      />

      <Input
        id="household-address"
        label="Address"
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        error={addressError}
        autoComplete="off"
      />

      {/* A HOUSEHOLD-LEVEL flag, and a separate axis from a member's `do_not_contact` status.
          The helper text names the CONSEQUENCE rather than restating the label, because the
          consequence is the surprising half: the family does not disappear. It stays on the
          roster and stays on the visit dashboard, marked — a household that vanished from a
          president's list is one nobody can hand on to the next presidency (ITER-018 Decision 4).

          Written under `roster.manage`, which is what PATCH /api/households/[id] already
          asserts — no permission change. A household's visit CADENCE is a different decision
          under a different permission, and has its own route. */}
      <div className="flex flex-col gap-1.5">
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            checked={doNotContact}
            onChange={(event) => setDoNotContact(event.target.checked)}
          />
          Do not contact this household
        </label>
        <p className="text-sm text-muted">
          The family stays on the roster and stays visible on the visit dashboard. It is left out
          of every visit statistic.
        </p>
      </div>

      <FormError message={formError} />

      {statusMessage && (
        <p role="status" className="text-sm text-muted">
          {statusMessage}
        </p>
      )}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : isEditing ? "Save household" : "Add household"}
      </Button>
    </form>
  );
}
