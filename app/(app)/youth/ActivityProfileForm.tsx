"use client";

import { useState } from "react";
import { MemberPicker } from "@/components/roster/MemberPicker";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import {
  MAX_ACTIVITY_NAME,
  MAX_ACTIVITY_NOTES,
  MAX_SCHOOL_ORG,
  MAX_SEASON_SCHEDULE,
  PROFILE_MEMBER_CATEGORIES,
} from "@/lib/validation/youth";
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  type ActivityType,
  type SessionUser,
} from "@/types/domain";

// One activity — A TEAM — and the young people on it. Used to create and to edit; the difference
// is whether `initial` is supplied, because a create form and an edit form that drift apart is
// two forms to keep correct.
//
// ---------------------------------------------------------------------------
// THE PICKER IS MULTI-SELECT NOW, AND AN EMPTY CHOICE IS ALLOWED (youth-j)
// ---------------------------------------------------------------------------
// A profile was one young person's copy of a team, so the form asked for exactly one. A profile
// is a TEAM now (migration 062), so it asks which young people are on it — and submitting with
// NONE is a legitimate answer rather than an error.
//
// That is ITER-033's flow in the user's own words: IMPORT ONCE, THEN ASSIGN. A leader creating
// "Varsity Basketball" so they have somewhere to import a schedule to does not yet know or care
// who is on it, and forcing them to name the players first is exactly the friction this slice
// exists to remove. The empty state is made LOUD afterwards, on RosterPanel and on the calendar
// (lib/youth/roster.ts's branch 5), rather than refused here.
//
// THE FILTER COMES FROM lib/validation/youth.ts, not from a literal here. PROFILE_MEMBER_CATEGORIES
// is the single answer to "which member may an activity profile name", and the ROUTE reads the
// same constant — a picker that offers a name the route then refuses is the two-places-disagreeing
// failure this project keeps a rule about.
//
// MemberPicker's interface is FROZEN (see its header). This uses only `filter.categories` and
// `mode="inline"`, both of which have existed since roster-b. Nothing was added for slice A.

export type ActivityProfileDraft = {
  memberIds: string[];
  activityName: string;
  activityType: ActivityType;
  schoolOrg: string;
  seasonSchedule: string;
  notes: string;
  orgId: string | null;
};

export type ActivityProfileFormProps = {
  user: SessionUser;
  // Absent when creating. ON EDIT THE ROSTER IS NOT TOUCHED HERE AT ALL — it is its own resource
  // with its own routes and its own audit rows (RosterPanel, and lib/validation/youth.ts's
  // updateActivityProfileSchema header). Adding a player, recording that one left mid-season and
  // taking one off by mistake are three distinct, separately auditable acts rather than a field
  // on an edit form.
  initial?: ActivityProfileDraft;
  // Rendered for a bishopric author ONLY. Everyone else gets no control at all rather than a
  // disabled one showing their own organization: their organization is not theirs to choose, and
  // a disabled select invites the question of why it is disabled.
  organizations?: { id: string; label: string }[];
  submitLabel: string;
  saving: boolean;
  error?: string;
  onSubmit: (draft: ActivityProfileDraft) => void;
  onCancel: () => void;
};

const EMPTY_DRAFT: ActivityProfileDraft = {
  memberIds: [],
  activityName: "",
  activityType: "sport",
  schoolOrg: "",
  seasonSchedule: "",
  notes: "",
  orgId: null,
};

const FIELD_CLASSES =
  "rounded-md border border-border bg-surface-raised px-3 py-2 text-base text-foreground " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

// The two differ only in their minimum height, and they are separate constants rather than one
// plus an override: `min-h-11` and `min-h-24` are the same Tailwind property, so which one won
// would depend on their order in the GENERATED stylesheet rather than in the class string.
const SELECT_CLASSES = `min-h-11 ${FIELD_CLASSES}`;
const TEXTAREA_CLASSES = `min-h-24 ${FIELD_CLASSES}`;

export function ActivityProfileForm({
  user,
  initial,
  organizations,
  submitLabel,
  saving,
  error,
  onSubmit,
  onCancel,
}: ActivityProfileFormProps) {
  const [draft, setDraft] = useState<ActivityProfileDraft>(initial ?? EMPTY_DRAFT);
  const [localError, setLocalError] = useState<string | undefined>(undefined);

  const editing = initial !== undefined;

  function submit(): void {
    // NO CHECK ON `memberIds`, DELIBERATELY. An empty roster is a legitimate answer — see the
    // header. The route accepts it too (createActivityProfileSchema defaults to `[]`), so the
    // form and the API agree rather than one refusing what the other allows.
    if (draft.activityName.trim() === "") {
      setLocalError("Give the activity a name.");
      return;
    }

    setLocalError(undefined);
    onSubmit(draft);
  }

  return (
    <div className="flex flex-col gap-4">
      {editing ? (
        // Stated rather than offered, which is the difference between an edit form and a form
        // that has simply lost a field. It also NAMES WHERE THE ROSTER IS EDITED, because a
        // leader who came here to add a player needs to be sent somewhere rather than left
        // wondering whether the control has gone.
        <p className="text-sm text-muted">
          Editing an activity. Who is on it is changed on the card itself, under
          &ldquo;Who is on this&rdquo;.
        </p>
      ) : (
        <MemberPicker
          value={draft.memberIds}
          onChange={(memberIds) => setDraft((current) => ({ ...current, memberIds }))}
          user={user}
          multiple
          filter={{ categories: PROFILE_MEMBER_CATEGORIES }}
          mode="inline"
          label="Who is on this"
          emptyMessage="No youth on the roster yet."
          disabled={saving}
        />
      )}

      {/* THE "add them later" PATH, SAID OUT LOUD. Without it, a leader who wants to import a
          schedule first has no way of knowing that submitting with nobody selected is allowed —
          and a permitted path nobody can see is not a path. */}
      {editing ? null : (
        <p className="-mt-2 text-xs text-muted">
          You can leave this empty and add the young people once the schedule is in.
        </p>
      )}

      <Input
        id="activity-name"
        label="Activity"
        value={draft.activityName}
        maxLength={MAX_ACTIVITY_NAME}
        disabled={saving}
        placeholder="Varsity basketball"
        onChange={(event) =>
          setDraft((current) => ({ ...current, activityName: event.target.value }))
        }
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="activity-type" className="text-sm font-medium text-foreground">
          Kind of activity
        </label>
        <select
          id="activity-type"
          className={SELECT_CLASSES}
          value={draft.activityType}
          disabled={saving}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              activityType: event.target.value as ActivityType,
            }))
          }
        >
          {ACTIVITY_TYPES.map((activityType) => (
            <option key={activityType} value={activityType}>
              {ACTIVITY_TYPE_LABELS[activityType]}
            </option>
          ))}
        </select>
      </div>

      <Input
        id="activity-school-org"
        label="School or club"
        value={draft.schoolOrg}
        maxLength={MAX_SCHOOL_ORG}
        disabled={saving}
        placeholder="Lincoln High School"
        onChange={(event) =>
          setDraft((current) => ({ ...current, schoolOrg: event.target.value }))
        }
      />

      <Input
        id="activity-season"
        label="Season"
        value={draft.seasonSchedule}
        maxLength={MAX_SEASON_SCHEDULE}
        disabled={saving}
        placeholder="November to February"
        onChange={(event) =>
          setDraft((current) => ({ ...current, seasonSchedule: event.target.value }))
        }
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="activity-notes" className="text-sm font-medium text-foreground">
          Notes
        </label>
        <textarea
          id="activity-notes"
          rows={3}
          maxLength={MAX_ACTIVITY_NOTES}
          disabled={saving}
          value={draft.notes}
          placeholder="Anything the other leaders should know."
          className={TEXTAREA_CLASSES}
          onChange={(event) =>
            setDraft((current) => ({ ...current, notes: event.target.value }))
          }
        />
      </div>

      {/* Only a bishopric author is handed this. `organizations` is undefined for everyone else,
          so the control is ABSENT rather than disabled — an org leader's organization is stamped
          from their session and is not a decision the form asks them to make. */}
      {organizations === undefined || editing ? null : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="activity-org" className="text-sm font-medium text-foreground">
            Which organization looks after this
          </label>
          <select
            id="activity-org"
            className={SELECT_CLASSES}
            value={draft.orgId ?? ""}
            disabled={saving}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                orgId: event.target.value === "" ? null : event.target.value,
              }))
            }
          >
            {/* The empty option is a real choice with a real meaning, not a placeholder. A
                ward-wide activity belongs to no presidency and notifies none. */}
            <option value="">The whole ward</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <FormError message={localError ?? error} />

      <div className="flex flex-wrap gap-2">
        <Button onClick={submit} disabled={saving}>
          {saving ? "Saving…" : submitLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
