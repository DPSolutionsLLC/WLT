"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import type { Member } from "@/lib/roster/queries";
import { createMemberSchema } from "@/lib/validation/roster";
import {
  MEMBER_CATEGORIES,
  MEMBER_GENDERS,
  MEMBER_STATUSES,
  type MemberCategory,
  type MemberGender,
  type MemberStatus,
} from "@/types/domain";

export type MemberFormHousehold = {
  id: string;
  familyName: string;
  address: string | null;
};

export type MemberFormProps = {
  member?: Member;
  households: MemberFormHousehold[];
  onSaved?: (member: Member) => void;
};

const SELECT_CLASSES =
  "min-h-11 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

const CATEGORY_LABELS: Record<MemberCategory, string> = {
  adult: "Adult",
  youth: "Youth",
  child: "Child",
};

const GENDER_LABELS: Record<MemberGender, string> = {
  male: "Male",
  female: "Female",
};

const STATUS_LABELS: Record<MemberStatus, string> = {
  active: "Active",
  moved_out: "Moved Out",
  do_not_contact: "Do Not Contact",
};

// Two households can share a family name, so the select shows the address too — otherwise the
// person filling this in is choosing between two identical options.
function householdLabel(household: MemberFormHousehold): string {
  return household.address
    ? `${household.familyName} — ${household.address}`
    : household.familyName;
}

export function MemberForm({ member, households, onSaved }: MemberFormProps) {
  const router = useRouter();
  const isEditing = member !== undefined;

  const [firstName, setFirstName] = useState(member?.firstName ?? "");
  const [lastName, setLastName] = useState(member?.lastName ?? "");
  const [householdId, setHouseholdId] = useState(member?.householdId ?? "");
  const [category, setCategory] = useState(member?.category ?? "");
  const [gender, setGender] = useState(member?.gender ?? "");
  const [status, setStatus] = useState<MemberStatus>(member?.status ?? "active");
  const [phone, setPhone] = useState(member?.phone ?? "");

  const [firstNameError, setFirstNameError] = useState<string>();
  const [lastNameError, setLastNameError] = useState<string>();
  const [phoneError, setPhoneError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [statusMessage, setStatusMessage] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    setFirstNameError(undefined);
    setLastNameError(undefined);
    setPhoneError(undefined);
    setStatusMessage(undefined);

    const parsed = createMemberSchema.safeParse({
      householdId: householdId === "" ? null : householdId,
      firstName,
      lastName,
      category: category === "" ? null : category,
      gender: gender === "" ? null : gender,
      status,
      phone: phone.trim() === "" ? null : phone,
    });

    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      setFirstNameError(fieldErrors.firstName?.[0]);
      setLastNameError(fieldErrors.lastName?.[0]);
      setPhoneError(fieldErrors.phone?.[0]);

      const named = fieldErrors.firstName ?? fieldErrors.lastName ?? fieldErrors.phone;
      if (!named) setFormError("Check the form and try again.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(
        isEditing ? `/api/members/${member.id}` : "/api/members",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );

      const body: { member?: Member; error?: string } = await response.json();

      if (!response.ok || !body.member) {
        setFormError(body.error ?? "Could not save the member. Please try again.");
        return;
      }

      setStatusMessage(
        isEditing ? "Saved." : `Added ${body.member.firstName} ${body.member.lastName}.`,
      );

      if (!isEditing) {
        setFirstName("");
        setLastName("");
        setPhone("");
      }

      onSaved?.(body.member);
      router.refresh();
    } catch (error) {
      console.error("Could not save the member", error);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <Input
        id="member-first-name"
        label="First name"
        value={firstName}
        onChange={(event) => setFirstName(event.target.value)}
        error={firstNameError}
        autoComplete="off"
        required
      />

      <Input
        id="member-last-name"
        label="Last name"
        value={lastName}
        onChange={(event) => setLastName(event.target.value)}
        error={lastNameError}
        autoComplete="off"
        required
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="member-household" className="text-sm font-medium text-foreground">
          Household
        </label>
        <select
          id="member-household"
          className={SELECT_CLASSES}
          value={householdId}
          onChange={(event) => setHouseholdId(event.target.value)}
        >
          <option value="">No household</option>
          {households.map((household) => (
            <option key={household.id} value={household.id}>
              {householdLabel(household)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="member-category" className="text-sm font-medium text-foreground">
          Category
        </label>
        <select
          id="member-category"
          className={SELECT_CLASSES}
          value={category}
          onChange={(event) => setCategory(event.target.value as MemberCategory | "")}
        >
          <option value="">Not set</option>
          {MEMBER_CATEGORIES.map((option) => (
            <option key={option} value={option}>
              {CATEGORY_LABELS[option]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="member-gender" className="text-sm font-medium text-foreground">
          Gender
        </label>
        <select
          id="member-gender"
          className={SELECT_CLASSES}
          value={gender}
          onChange={(event) => setGender(event.target.value as MemberGender | "")}
        >
          <option value="">Not set</option>
          {MEMBER_GENDERS.map((option) => (
            <option key={option} value={option}>
              {GENDER_LABELS[option]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="member-status" className="text-sm font-medium text-foreground">
          Status
        </label>
        <select
          id="member-status"
          className={SELECT_CLASSES}
          value={status}
          onChange={(event) => setStatus(event.target.value as MemberStatus)}
        >
          {MEMBER_STATUSES.map((option) => (
            <option key={option} value={option}>
              {STATUS_LABELS[option]}
            </option>
          ))}
        </select>
        <p className="text-sm text-muted">
          Members who leave the ward are marked Moved Out rather than deleted, so their
          history survives.
        </p>
      </div>

      <Input
        id="member-phone"
        label="Phone"
        type="tel"
        inputMode="tel"
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
        error={phoneError}
        autoComplete="off"
      />

      <FormError message={formError} />

      {statusMessage && (
        <p role="status" className="text-sm text-muted">
          {statusMessage}
        </p>
      )}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : isEditing ? "Save member" : "Add member"}
      </Button>
    </form>
  );
}
