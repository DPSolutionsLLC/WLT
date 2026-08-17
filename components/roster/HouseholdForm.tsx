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
