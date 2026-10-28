"use client";

import { useQuery } from "@tanstack/react-query";
import {
  MEMBERS_QUERY_KEY,
  MemberPicker,
  resolvePickerFilter,
} from "@/components/roster/MemberPicker";
import { Input } from "@/components/ui/Input";
import type { Member } from "@/lib/roster/queries";
import type { SessionUser } from "@/types/domain";

// The person on a Zoom hand-out or edit (ITER-053, z2b): a roster member OR a typed name, then
// phone, email and notes. Shared by HandOutModal and EditInviteeModal so the two cannot drift.
//
// The picker offers ACTIVE members of the whole ward (D4) — MemberPicker's default status filter,
// with `wholeWard` so a bishopric member is never narrowed to an organization. Picking somebody
// fills the name and, when the phone box is empty, their phone on file.

export type InviteeDraft = {
  memberId: string | null;
  displayName: string;
  phone: string;
  email: string;
  notes: string;
};

export const EMPTY_INVITEE_DRAFT: InviteeDraft = {
  memberId: null,
  displayName: "",
  phone: "",
  email: "",
  notes: "",
};

// What the routes accept. Blank optional fields go as null — the schema would turn "" into null
// too, but sending null says what is meant.
export function draftToBody(draft: InviteeDraft) {
  const orNull = (value: string) => (value.trim() === "" ? null : value.trim());
  return {
    memberId: draft.memberId,
    displayName: draft.displayName.trim(),
    phone: orNull(draft.phone),
    email: orNull(draft.email),
    notes: orNull(draft.notes),
  };
}

export function memberDisplayName(member: Pick<Member, "firstName" | "lastName">): string {
  return `${member.firstName} ${member.lastName}`.trim();
}

async function fetchActiveMembers(statuses: readonly string[]): Promise<Member[]> {
  const params = new URLSearchParams();
  for (const status of statuses) params.append("status", status);
  const response = await fetch(`/api/members?${params.toString()}`);
  let payload: { members?: unknown; error?: unknown };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string" ? payload.error : "Could not load the ward's members.",
    );
  }
  return (payload.members ?? []) as Member[];
}

export type InviteeFieldsProps = {
  idPrefix: string;
  user: SessionUser;
  draft: InviteeDraft;
  onChange: (draft: InviteeDraft) => void;
  // "roster" shows the picker, "typed" a plain name box.
  personMode: "roster" | "typed";
  onPersonModeChange: (mode: "roster" | "typed") => void;
  disabled?: boolean;
};

export function InviteeFields({
  idPrefix,
  user,
  draft,
  onChange,
  personMode,
  onPersonModeChange,
  disabled = false,
}: InviteeFieldsProps) {
  // The SAME query key MemberPicker uses for this filter, so the two share one fetch of the roster.
  const pickerFilter = resolvePickerFilter({ value: [], onChange: () => {}, user, wholeWard: true }, user);
  const membersQuery = useQuery({
    queryKey: [MEMBERS_QUERY_KEY, pickerFilter],
    queryFn: () => fetchActiveMembers(pickerFilter.statuses ?? ["active"]),
  });

  function pickMember(memberIds: string[]) {
    const memberId = memberIds[0] ?? null;
    if (memberId === null) {
      onChange({ ...draft, memberId: null, displayName: "" });
      return;
    }
    const member = membersQuery.data?.find((candidate) => candidate.id === memberId);
    onChange({
      ...draft,
      memberId,
      displayName: member ? memberDisplayName(member) : draft.displayName,
      phone: draft.phone.trim() === "" && member?.phone ? member.phone : draft.phone,
    });
  }

  function switchMode(mode: "roster" | "typed") {
    onPersonModeChange(mode);
    onChange({ ...draft, memberId: null, displayName: "" });
  }

  return (
    <div className="flex flex-col gap-4">
      {personMode === "roster" ? (
        <div className="flex flex-col gap-1">
          <MemberPicker
            value={draft.memberId === null ? [] : [draft.memberId]}
            onChange={pickMember}
            user={user}
            multiple={false}
            wholeWard
            mode="inline"
            label="Who is it for?"
            disabled={disabled}
          />
          {membersQuery.isError ? (
            <p role="alert" className="text-sm text-danger">
              {membersQuery.error instanceof Error
                ? membersQuery.error.message
                : "Could not load the ward's members."}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => switchMode("typed")}
            disabled={disabled}
            className="min-h-11 self-start text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Not on the roster? Type their name
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <Input
            id={`${idPrefix}-name`}
            label="Their name"
            value={draft.displayName}
            onChange={(event) => onChange({ ...draft, memberId: null, displayName: event.target.value })}
            maxLength={120}
            autoComplete="off"
            disabled={disabled}
            required
          />
          <button
            type="button"
            onClick={() => switchMode("roster")}
            disabled={disabled}
            className="min-h-11 self-start text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Pick from the roster instead
          </button>
        </div>
      )}

      <Input
        id={`${idPrefix}-phone`}
        label="Phone (optional)"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={draft.phone}
        onChange={(event) => onChange({ ...draft, phone: event.target.value })}
        maxLength={40}
        disabled={disabled}
      />

      <Input
        id={`${idPrefix}-email`}
        label="Email (optional)"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={draft.email}
        onChange={(event) => onChange({ ...draft, email: event.target.value })}
        maxLength={254}
        disabled={disabled}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-notes`} className="text-sm font-medium text-foreground">
          Notes (optional)
        </label>
        <textarea
          id={`${idPrefix}-notes`}
          rows={2}
          maxLength={1000}
          value={draft.notes}
          onChange={(event) => onChange({ ...draft, notes: event.target.value })}
          disabled={disabled}
          className="min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
      </div>
    </div>
  );
}
