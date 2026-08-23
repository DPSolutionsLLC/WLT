"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MemberPickerModal } from "@/components/roster/MemberPickerModal";
import {
  ReliabilityFlag,
  type ReliabilityFlagKind,
} from "@/components/roster/ReliabilityFlag";
import type { HouseholdWithMembers, Member } from "@/lib/roster/queries";
import { defaultOrganizationFilter } from "@/lib/roster/organizationScope";
import type { MemberFilters } from "@/lib/validation/roster";
import type {
  MemberCategory,
  MemberGender,
  MemberStatus,
  SessionUser,
} from "@/types/domain";

// ============================================================================
// THE INTERFACE BELOW IS FROZEN. Phases 4, 7, 8 and 10 all consume this component, and
// 02-roster.md §Pitfalls is blunt about the cost: "changing its signature later means touching
// every module." A later phase that needs something the props table does not cover should RAISE
// IT rather than adding a prop quietly.
//
// Every prop and who needs it:
//
//   value / onChange   required            Everyone. Controlled, always an array — `multiple:
//                                          false` passes an array of length 0 or 1, so no
//                                          consumer branches on the shape (roster-b Decision 1)
//   user               required            The session, so the organization default can be
//                                          applied here instead of at every call site
//                                          (roster-b Decision 4). Added during roster-b — see
//                                          the note below
//   multiple           false               Phase 4 (three speakers), Phase 10 (blesser pairs)
//   max                none                Phase 10 caps a pair at 2; Phase 4 at the slot count
//   filter.categories  none                Phase 10 needs youth only; Phase 4 separates youth
//                                          and adult speakers
//   filter.genders     none                Phase 10 — sacrament ordinances draw from young men
//   filter.statuses    ["active"]          The safe default from roster-a. NEVER widened here
//   filter.organizationId  from the session Phase 7 — an EQ president's visit picker
//   filter.householdId none                Phase 7 — a member within an already-chosen household
//   excludeIds         []                  Phase 10 — the water blesser differs from the bread
//   allowDoNotContact  false               Offers the confirmation control (Decision 2)
//   showFlags          false               Phase 4 planning view, bishopric only
//   flags              none                The reliability flags per member id, rendered when
//                                          showFlags is on. Added during talks-d — see below
//   annotations        none                A short read-only note per member id, rendered beside
//                                          the name. Phase 4's prayer board shows "Last prayed
//                                          March 2025" here. Added during talks-c — see below
//   mode               "modal"             Inline for a form field, modal for everything else
//
// `annotations` is the second addition, made in talks-c and RAISED rather than added quietly,
// which is what the rule above asks for. The prayer board's whole reason to exist is spreading
// prayers around the ward, and that judgement is made WHILE choosing a name — a "last prayed"
// column somewhere else on the page is a different, worse product. It is deliberately a plain
// `Record<string, string>` of already-formatted text rather than anything prayer-shaped: the
// picker renders a note it is handed and knows nothing about where it came from, so Phase 7's
// "last visited" and Phase 10's "last blessed" need no further change here.
//
// An ABSENT key renders nothing at all — not an empty span, not a dash. That is load-bearing for
// its first caller: "Never" beside a name reads as a judgement about the person rather than as
// an absence of data (lib/prayers/lastPrayed.ts).
//
// `flags` is the third addition, made in talks-d and RAISED for the same reason. `showFlags` has
// existed since roster-b and rendered nothing, because nothing could compute a flag until the
// pipeline wrote history; the caller that sets it (SpeakerField, inside the assignment modal) is
// exactly the planning view the flags are for. It follows `annotations` deliberately: a
// per-member-id record the picker renders and knows nothing about, with an absent key rendering
// nothing at all. The data is bishopric-only by RLS — `assignment_history` is in migration 019's
// bishopric loop, so a non-bishopric caller computes an empty record and this renders nothing.
//
// `user` is the one addition to roster-b's table. The plan has both the page and the picker
// call defaultOrganizationFilter(), which a client component cannot do without the session —
// and passing SessionUser into a client component is already how TopNav works. The alternative
// was to make every future caller remember to pass filter.organizationId, which is exactly the
// invisible default Decision 4 set out to avoid.
// ============================================================================

export type MemberPickerFilter = {
  categories?: readonly MemberCategory[];
  genders?: readonly MemberGender[];
  statuses?: readonly MemberStatus[];
  organizationId?: string;
  householdId?: string;
};

export type MemberPickerProps = {
  value: readonly string[];
  onChange: (memberIds: string[]) => void;
  user: SessionUser;
  multiple?: boolean;
  max?: number;
  filter?: MemberPickerFilter;
  excludeIds?: readonly string[];
  allowDoNotContact?: boolean;
  showFlags?: boolean;
  flags?: Readonly<Record<string, readonly ReliabilityFlagKind[]>>;
  annotations?: Readonly<Record<string, string>>;
  mode?: "modal" | "inline";
  label?: string;
  triggerLabel?: string;
  emptyMessage?: string;
  disabled?: boolean;
};

// Every roster mutation invalidates this key so an open picker reflects the change.
export const MEMBERS_QUERY_KEY = "members";
export const HOUSEHOLDS_QUERY_KEY = "households";

export const DO_NOT_CONTACT_CONFIRMATION =
  "This member is marked Do Not Contact. Include them anyway?";

const NO_HOUSEHOLD_LABEL = "No household";

// Only what the SERVER can filter on, and therefore only what belongs in the query key. Two
// pickers with different category or gender filters share one fetch of the same ward-and-status
// slice; the rest is narrowed in memory by narrowPickerMembers below. On a roster of a few
// hundred that trade is free, and it means opening five pickers in a planning session is one
// request rather than five.
export function resolvePickerFilter(
  props: MemberPickerProps,
  user: SessionUser,
): MemberFilters {
  // Built as an allow-list rather than by subtracting from what was asked for. `moved_out` is
  // absent because it is never added — not because a filter removed it — so no combination of
  // props can put it back. No picker in any phase may offer a member who has moved out; that
  // is the assertion the whole roster's numbers rest on (02-roster.md §Pitfalls).
  const permitted: MemberStatus[] = props.allowDoNotContact
    ? ["active", "do_not_contact"]
    : ["active"];

  const requested = props.filter?.statuses;
  const statuses = requested
    ? permitted.filter((status) => requested.includes(status))
    : permitted;

  // An explicit organization beats the session default, so a bishopric caller can point a
  // picker at one organization and an org leader can be handed a different one.
  const organizationId =
    props.filter?.organizationId ?? defaultOrganizationFilter(user);

  return {
    statuses: statuses.length > 0 ? statuses : ["active"],
    ...(organizationId ? { organizationId } : {}),
  };
}

export type NarrowPickerOptions = {
  categories?: readonly MemberCategory[];
  genders?: readonly MemberGender[];
  householdId?: string;
  excludeIds?: readonly string[];
  search?: string;
  householdNames?: Record<string, string>;
};

function matchesSearch(
  member: Member,
  term: string,
  householdNames: Record<string, string>,
): boolean {
  const householdName = member.householdId
    ? (householdNames[member.householdId] ?? "")
    : "";

  return [member.firstName, member.lastName, householdName]
    .join(" ")
    .toLowerCase()
    .includes(term);
}

// Applied after the fetch, never folded into the query key. excludeIds in particular changes
// every time a picker opens — keying on it would fragment the cache into one entry per opening
// and defeat the point of caching the roster at all.
export function narrowPickerMembers(
  members: readonly Member[],
  options: NarrowPickerOptions,
): Member[] {
  const excluded = new Set(options.excludeIds ?? []);
  const term = options.search?.trim().toLowerCase();
  const householdNames = options.householdNames ?? {};

  return members.filter((member) => {
    if (excluded.has(member.id)) return false;

    if (options.categories && options.categories.length > 0) {
      if (!member.category || !options.categories.includes(member.category)) return false;
    }

    if (options.genders && options.genders.length > 0) {
      if (!member.gender || !options.genders.includes(member.gender)) return false;
    }

    if (options.householdId && member.householdId !== options.householdId) return false;

    if (term && !matchesSearch(member, term, householdNames)) return false;

    return true;
  });
}

export type MemberGroup = {
  householdId: string | null;
  householdName: string;
  members: Member[];
};

// FEATURES.md §Module 1 and 02-roster.md both say every assignment and activity module browses
// members THROUGH the household view. Members with no household are grouped last rather than
// dropped — losing someone silently is the bug the flat roster list exists to prevent.
export function groupMembersByHousehold(
  members: readonly Member[],
  householdNames: Record<string, string>,
): MemberGroup[] {
  const groups = new Map<string, MemberGroup>();
  const unhoused: Member[] = [];

  for (const member of members) {
    if (!member.householdId) {
      unhoused.push(member);
      continue;
    }

    const existing = groups.get(member.householdId);
    if (existing) {
      existing.members.push(member);
      continue;
    }

    groups.set(member.householdId, {
      householdId: member.householdId,
      householdName: householdNames[member.householdId] ?? NO_HOUSEHOLD_LABEL,
      members: [member],
    });
  }

  const sorted = [...groups.values()].sort((left, right) =>
    left.householdName.localeCompare(right.householdName),
  );

  if (unhoused.length > 0) {
    sorted.push({
      householdId: null,
      householdName: NO_HOUSEHOLD_LABEL,
      members: unhoused,
    });
  }

  return sorted;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

async function fetchPickerMembers(filter: MemberFilters): Promise<Member[]> {
  const params = new URLSearchParams();

  if (filter.organizationId) params.set("organizationId", filter.organizationId);
  // The route reads getAll("status"), singular — a `statuses` parameter would be ignored and
  // the default would silently apply instead.
  for (const status of filter.statuses ?? []) params.append("status", status);

  const response = await fetch(`/api/members?${params.toString()}`);
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Could not load the ward's members.",
    );
  }

  return (payload.members ?? []) as Member[];
}

async function fetchHouseholdNames(): Promise<Record<string, string>> {
  const response = await fetch("/api/households");
  const payload = await readJson(response);

  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : "Could not load the ward's households.",
    );
  }

  const households = (payload.households ?? []) as HouseholdWithMembers[];

  return Object.fromEntries(
    households.map((household) => [household.id, household.familyName]),
  );
}

export function MemberPicker(props: MemberPickerProps) {
  const {
    value,
    onChange,
    user,
    multiple = false,
    max,
    filter,
    excludeIds,
    allowDoNotContact = false,
    showFlags = false,
    flags,
    annotations,
    mode = "modal",
    label = "Choose a member",
    triggerLabel,
    emptyMessage,
    disabled = false,
  } = props;

  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Decision 2: allowDoNotContact does NOT mean "include them". It means "offer a control that,
  // once confirmed, reveals them". Until that happens they are not fetched at all, so a
  // do-not-contact member cannot reach the browser through a component that forgot to hide them.
  const [isDoNotContactRevealed, setIsDoNotContactRevealed] = useState(false);

  // Not memoised. TanStack Query hashes the query key structurally rather than by identity, so
  // a fresh object each render is the same key — and memoising a value that feeds a hash buys
  // nothing but a dependency array to keep correct.
  const resolvedFilter = resolvePickerFilter(
    { ...props, allowDoNotContact: isDoNotContactRevealed },
    user,
  );

  const membersQuery = useQuery({
    queryKey: [MEMBERS_QUERY_KEY, resolvedFilter],
    queryFn: () => fetchPickerMembers(resolvedFilter),
  });

  const householdsQuery = useQuery({
    queryKey: [HOUSEHOLDS_QUERY_KEY],
    queryFn: fetchHouseholdNames,
  });

  const householdNames = householdsQuery.data ?? {};
  const fetched = membersQuery.data ?? [];

  const visible = narrowPickerMembers(fetched, {
    categories: filter?.categories,
    genders: filter?.genders,
    householdId: filter?.householdId,
    excludeIds,
    search: searchTerm,
    householdNames,
  });

  // A search flattens the household grouping to the matching members; clearing it restores the
  // grouping. Reading a name under a family heading is the point of the household view, and it
  // stops being the point the moment somebody is looking for one person.
  const groups: MemberGroup[] =
    searchTerm.trim() === ""
      ? groupMembersByHousehold(visible, householdNames)
      : [{ householdId: null, householdName: "", members: visible }];

  const selectedIds = new Set(value);
  const isMaxReached = max !== undefined && value.length >= max;

  const selectedMembers = value
    .map((id) => fetched.find((member) => member.id === id))
    .filter((member): member is Member => member !== undefined);

  function toggle(memberId: string): void {
    if (disabled) return;

    if (selectedIds.has(memberId)) {
      onChange(value.filter((id) => id !== memberId));
      return;
    }

    // Single-select REPLACES rather than appends, and still hands back an array so no consumer
    // has to branch on the shape.
    if (!multiple) {
      onChange([memberId]);
      setIsOpen(false);
      return;
    }

    if (isMaxReached) return;

    onChange([...value, memberId]);
  }

  function revealDoNotContact(): void {
    // A browser confirm rather than a bespoke dialog: this is a refusal to bypass, it must be
    // impossible to miss, and there is no existing confirmation pattern in this app to follow.
    if (window.confirm(DO_NOT_CONTACT_CONFIRMATION)) {
      setIsDoNotContactRevealed(true);
    }
  }

  const errorMessage =
    membersQuery.error instanceof Error
      ? membersQuery.error.message
      : householdsQuery.error instanceof Error
        ? householdsQuery.error.message
        : undefined;

  const body = (
    <div className="flex flex-col gap-3">
      {selectedMembers.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {selectedMembers.map((member) => (
            <li key={member.id}>
              <button
                type="button"
                onClick={() => toggle(member.id)}
                disabled={disabled}
                aria-label={`Remove ${member.firstName} ${member.lastName}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-3 text-sm text-foreground hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
              >
                {member.firstName} {member.lastName}
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="member-picker-search" className="text-sm font-medium text-foreground">
          Search
        </label>
        <input
          id="member-picker-search"
          type="search"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="First name, last name, or family name"
          autoComplete="off"
          className="min-h-11 rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
      </div>

      {isMaxReached && (
        <p className="text-sm text-muted" role="status">
          {max} selected, which is the most this allows. Remove one to choose another.
        </p>
      )}

      {errorMessage && (
        <p role="alert" className="text-sm text-danger">
          {errorMessage}
        </p>
      )}

      {membersQuery.isPending ? (
        <p className="text-sm text-muted">Loading the roster…</p>
      ) : fetched.length === 0 ? (
        // "Nobody is in the roster" and "nobody matches what you asked for" are different
        // answers, and a picker that gives the same message for both sends the user looking for
        // the wrong problem.
        <p className="text-sm text-muted">
          {emptyMessage ?? "There are no members in the roster yet."}
        </p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted">No members match this filter.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {groups.map((group) => (
            <li key={group.householdId ?? group.householdName}>
              {group.householdName !== "" && (
                <p className="mb-1 text-sm font-semibold text-foreground">
                  {group.householdName}
                </p>
              )}

              <ul className="flex flex-col">
                {group.members.map((member) => {
                  const isSelected = selectedIds.has(member.id);
                  const isDisabled = disabled || (!isSelected && isMaxReached);

                  return (
                    <li key={member.id}>
                      {/* A button, not a div with a click handler: the list has to be reachable
                          by keyboard and announced as selectable. */}
                      <button
                        type="button"
                        onClick={() => toggle(member.id)}
                        disabled={isDisabled}
                        aria-pressed={isSelected}
                        className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 ${
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : "text-foreground hover:bg-surface"
                        }`}
                      >
                        <span className="min-w-0">
                          {member.firstName} {member.lastName}
                          {member.status === "do_not_contact" && (
                            <span className="ml-2 text-xs">Do Not Contact</span>
                          )}
                          {annotations?.[member.id] && (
                            <span className="ml-2 text-xs opacity-80">
                              {annotations[member.id]}
                            </span>
                          )}
                        </span>

                        {showFlags && (
                          <ReliabilityFlag flags={flags?.[member.id] ?? []} />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {allowDoNotContact && !isDoNotContactRevealed && (
        <button
          type="button"
          onClick={revealDoNotContact}
          className="min-h-11 self-start text-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Include members marked Do Not Contact
        </button>
      )}
    </div>
  );

  if (mode === "inline") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {body}
      </div>
    );
  }

  return (
    <MemberPickerModal
      label={label}
      triggerLabel={triggerLabel}
      selectedCount={value.length}
      isOpen={isOpen}
      onOpen={() => setIsOpen(true)}
      onClose={() => setIsOpen(false)}
      disabled={disabled}
    >
      {body}
    </MemberPickerModal>
  );
}
