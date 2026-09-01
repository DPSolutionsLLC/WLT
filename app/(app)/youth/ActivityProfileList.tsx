"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActivityProfileForm,
  type ActivityProfileDraft,
} from "@/app/(app)/youth/ActivityProfileForm";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Modal } from "@/components/ui/Modal";
import {
  PROFILE_CLOSE_INVALIDATES,
  PROFILE_MUTATION_INVALIDATES,
  ROSTER_MUTATION_INVALIDATES,
  YOUTH_PROFILES_QUERY_KEY,
  errorFrom,
  fetchProfiles,
  readJson,
} from "@/app/(app)/youth/youthQueries";
import { RosterPanel } from "@/app/(app)/youth/RosterPanel";
import { canManageActivityProfile } from "@/lib/youth/activityOwnership";
import type { ActivityProfile } from "@/lib/youth/queries";
import type { RosterMember } from "@/lib/youth/roster";
import {
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_TYPE_TONES,
  type ContextTone,
  type SessionUser,
} from "@/types/domain";

// THE WARD'S YOUTH ACTIVITIES — ONE CARD PER TEAM (youth-j).
//
// ---------------------------------------------------------------------------
// THIS PAGE USED TO GROUP BY THE YOUNG PERSON, AND THAT WENT WITH THE MODEL
// ---------------------------------------------------------------------------
// A profile was one row per (member, activity), so a flat list of activities would have shown the
// same name three times — hence `groupByYouth`, a heading per youth and their activities beneath.
//
// A PROFILE IS A TEAM NOW (migration 062). Varsity Basketball is ONE row with a roster, not eight
// rows with eight names, so the grouping had nothing left to group: it would have produced one
// heading per young person each containing the same team, which is the duplication it existed to
// prevent, inverted. A card is an activity, listed by activity name, and the young people are on
// it — in RosterPanel — rather than above it.
//
// 08-youth-activities.md's first line still holds: one young person can be on a team AND in a
// choir AND on the debate squad. That question is answered on /youth, which groups by the young
// person from their MEMBERSHIPS. This page answers the other one — what teams does the ward have,
// and who is on each.
//
// PAGE.TSX IMPORTS ONLY THE COMPONENT FROM THIS FILE. A constant imported from a "use client"
// module reaches a Server Component as a function rather than as a string — the bug that made
// visits-d's "Log this visit" flow silently dead. The shared cache keys live in
// app/(app)/youth/youthQueries.ts, which the server never imports.
//
// WHICH activities carry Edit, Close and Remove is decided by canManageActivityProfile(), which
// mirrors migration 054d. Gating on `canManage` alone put those buttons on every organization's
// work and is defect youth-a-D1 (plans/retros, scenario 049). Close is inside the SAME gate, and
// deliberately so: a control the policy refuses is still a bug, four times over in this module.
//
// CLOSE IS THE PRIMARY ACTION; REMOVE IS THE EXCEPTION (ITER-028 / ITER-031). Closing a season
// destroys nothing and is reversible; removing an activity cascades to its events, its sign-ups,
// its follow-ups and the private notes rule 5 calls private forever — so `Remove` renders only
// when the activity has no events at all, and the server refuses one over a follow-up regardless.

export type ActivityProfileListProps = {
  initialProfiles: ActivityProfile[];
  user: SessionUser;
  // Resolved ONCE on the server from can(user, "youth_activities.manage", roleAccess) and threaded
  // down. A client component never re-derives a permission: it has no role access to resolve
  // against, and a second answer that disagreed with the route's would offer a control the API
  // refuses. `org_secretary` holds `youth_activities.view` and `.log` but NOT `.manage`, so they
  // read this list and see no buttons.
  canManage: boolean;
  // Non-null for a bishopric caller only — see ActivityProfileForm. Also supplies the name on the
  // ownership line of every card, for everybody.
  organizations: { id: string; label: string }[];
  canChooseOrganization: boolean;
};

// A STATIC Record, not an interpolated class name. Tailwind scans source text for COMPLETE class
// strings, so `text-tone-${tone}` compiles to nothing at all and the chip renders unstyled —
// components/visits/ReportTile.tsx records the same trap and this follows it exactly, colour and
// border on the surrounding surface rather than a fill. Every --tone-* token was measured against
// --surface in both themes; a fill would need its own second measurement per tone.
const TONE_CLASSES: Record<ContextTone, string> = {
  slate: "border-tone-slate text-tone-slate",
  blue: "border-tone-blue text-tone-blue",
  violet: "border-tone-violet text-tone-violet",
  magenta: "border-tone-magenta text-tone-magenta",
  teal: "border-tone-teal text-tone-teal",
  amber: "border-tone-amber text-tone-amber",
  rose: "border-tone-rose text-tone-rose",
};

const CHIP_CLASSES = "rounded-full border px-2 py-0.5 text-xs font-medium";

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// A count in a sentence needs a singular case, and a fixture with one of everything cannot catch
// the missing one (plans/retros/ai-b-*: "all 1 of its passages").
function activityCount(count: number): string {
  return count === 1 ? "1 activity" : `${count} activities`;
}

// The same rule for the roster, and it earns its place on the Close confirm: "Close Varsity
// Basketball? It affects 1 young person" is the sentence a fixture with four players cannot catch.
function youthCount(count: number): string {
  return count === 1 ? "1 young person" : `${count} young people`;
}

export function ActivityProfileList({
  initialProfiles,
  user,
  canManage,
  organizations,
  canChooseOrganization,
}: ActivityProfileListProps) {
  const queryClient = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ActivityProfile | null>(null);
  const [listError, setListError] = useState<string | undefined>(undefined);

  const profilesQuery = useQuery({
    queryKey: [YOUTH_PROFILES_QUERY_KEY],
    queryFn: fetchProfiles,
    initialData: initialProfiles,
  });

  // INVALIDATE BOTH KEYS, never write into the cache by hand. program-b found a hand-written cache
  // entry racing a refetch that was already in flight, and the loser was whichever finished second.
  //
  // BOTH, because a profile write moves the events too: deleting one cascades to its events
  // (migration 009), and creating one changes what the event form may offer. Invalidating only the
  // profiles key was defect youth-a-D2.
  async function invalidate(
    keys: readonly (readonly string[])[],
  ): Promise<void> {
    await Promise.all(
      keys.map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] })),
    );
  }

  async function refresh(): Promise<void> {
    await invalidate(PROFILE_MUTATION_INVALIDATES);
  }

  const createMutation = useMutation({
    mutationFn: async (draft: ActivityProfileDraft) => {
      const response = await fetch("/api/youth/profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          memberIds: draft.memberIds,
          activityName: draft.activityName.trim(),
          activityType: draft.activityType,
          schoolOrg: emptyToNull(draft.schoolOrg),
          seasonSchedule: emptyToNull(draft.seasonSchedule),
          notes: emptyToNull(draft.notes),
          // Sent ONLY when the bishopric picked one. An org leader's organization is stamped
          // from their session by the route, and sending a different one is refused with a
          // sentence rather than ignored — so the form does not send one at all.
          ...(draft.orgId === null ? {} : { orgId: draft.orgId }),
        }),
      });

      const payload = await readJson(response);
      if (!response.ok) throw new Error(errorFrom(payload, "Could not save that activity."));
    },
    onSuccess: async () => {
      setCreating(false);
      await refresh();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: ActivityProfileDraft }) => {
      const response = await fetch(`/api/youth/profiles/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activityName: draft.activityName.trim(),
          activityType: draft.activityType,
          schoolOrg: emptyToNull(draft.schoolOrg),
          seasonSchedule: emptyToNull(draft.seasonSchedule),
          notes: emptyToNull(draft.notes),
        }),
      });

      const payload = await readJson(response);
      if (!response.ok) throw new Error(errorFrom(payload, "Could not save that activity."));
    },
    onSuccess: async () => {
      setEditing(null);
      await refresh();
    },
  });

  // CLOSING AND REOPENING ARE ONE MUTATION AND ONE ROUTE, which is what makes a mistake
  // recoverable: the control on a closed season reads `Reopen` and sends `{ closed: false }`.
  const closeMutation = useMutation({
    mutationFn: async ({ id, closed }: { id: string; closed: boolean }) => {
      const response = await fetch(`/api/youth/profiles/${id}/close`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ closed }),
      });

      const payload = await readJson(response);
      if (!response.ok) throw new Error(errorFrom(payload, "Could not close that activity."));
    },
    onSuccess: async () => {
      setListError(undefined);
      await invalidate(PROFILE_CLOSE_INVALIDATES);
    },
    onError: (error: Error) => setListError(error.message),
  });

  // ---------------------------------------------------------------------------
  // THE THREE ROSTER MUTATIONS, ALL INVALIDATING ROSTER_MUTATION_INVALIDATES
  // ---------------------------------------------------------------------------
  // Adding or removing a young person moves every number derived from this team's events — the
  // denominators on /youth, the expected list on every calendar card, and whether a game reads
  // "Nobody going" at all. youthQueries.ts names the entries and says why all four; reasoning
  // about it per mutation is what this module has got wrong three times already.
  const rosterMutation = useMutation({
    mutationFn: async (request: { url: string; method: string; body?: unknown }) => {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.body === undefined ? {} : { "content-type": "application/json" },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
      });

      const payload = await readJson(response);
      if (!response.ok) {
        throw new Error(errorFrom(payload, "Could not change who is on that activity."));
      }
    },
    onSuccess: async () => {
      setListError(undefined);
      await invalidate(ROSTER_MUTATION_INVALIDATES);
    },
    onError: (error: Error) => setListError(error.message),
  });

  function addToRoster(profileId: string, memberId: string): void {
    rosterMutation.mutate({
      url: `/api/youth/profiles/${profileId}/roster`,
      method: "POST",
      body: { memberId },
    });
  }

  function setLeavingDate(rosterId: string, endedOn: string | null): void {
    rosterMutation.mutate({
      url: `/api/youth/roster/${rosterId}`,
      method: "PATCH",
      body: { endedOn },
    });
  }

  // A CONFIRM, BECAUSE THIS ONE ERASES SOMETHING. Removing a roster row destroys nothing a person
  // WROTE — follow-ups and private notes hang off events, not off this row (DELETE
  // /api/youth/roster/[id]'s header) — but it does erase that this young person was ever on the
  // team, and their games stop being counted retrospectively rather than from a date.
  //
  // WORDED BY CONSEQUENCE rather than by action (DocumentList.tsx's house rule), and it NAMES THE
  // ALTERNATIVE, because a leader reaching for this usually means "she left" rather than "she was
  // never here". That is the youth-h shape: refuse or warn, and say what to do instead.
  function removeFromRoster(member: RosterMember): void {
    const confirmed = window.confirm(
      `Take ${member.memberName} off this activity? ` +
        "It will be as though they were never on it, and their games stop counting towards how " +
        "well they are supported. If they left part-way through a season, use " +
        "“Left the team” instead so the games they did play still count.",
    );

    if (!confirmed) return;

    rosterMutation.mutate({
      url: `/api/youth/roster/${member.rosterId}`,
      method: "DELETE",
    });
  }

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/youth/profiles/${id}`, { method: "DELETE" });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(errorFrom(payload, "Could not remove that activity."));
    },
    onSuccess: async () => {
      setListError(undefined);
      await refresh();
    },
    onError: (error: Error) => setListError(error.message),
  });

  // CLOSE IS THE ORDINARY ACTION AND ITS CONFIRM IS A MILD ONE, because closing destroys nothing.
  //
  // "THEY", NEVER "HE OR SHE". This read "how well he or she is supported" until the walk on
  // 2026-08-31 (defect 060-D1). `ActivityProfile` carries no gender — nothing in this module does —
  // so the app has no pronoun for a member and must not imply one; "he or she" both guessed and
  // excluded. `members.gender` exists on the roster and is deliberately not plumbed here: a
  // sentence about coordination has no business asking.
  // It is still WORDED BY CONSEQUENCE rather than by action — DocumentList.tsx's house rule — and
  // it names the one thing a leader cannot see for themselves: that the season stops counting
  // towards how well this young person is supported. The last clause is what makes it a mild
  // dialog rather than a warning: it can be undone.
  function closeProfile(profile: ActivityProfile): void {
    // IT NAMES HOW MANY YOUNG PEOPLE IT AFFECTS, which is new with youth-j and is the one thing a
    // leader cannot see from the button. Closing used to end one young person's season; it now
    // ends a whole team's, and pressing it without knowing that is exactly the surprise a confirm
    // exists to prevent. An empty roster reads "It affects 0 young people", which is true and is
    // itself worth being told before closing something nobody is on.
    const confirmed = window.confirm(
      `Close ${profile.activityName}? It affects ${youthCount(profile.roster.length)}. ` +
        "Its games and follow-ups stay readable, and it stops counting towards how well they " +
        "are supported. You can reopen it.",
    );

    if (!confirmed) return;

    closeMutation.mutate({ id: profile.id, closed: true });
  }

  // NO CONFIRM ON REOPENING. It restores a state, destroys nothing and is itself undone by the
  // button beside it — a dialog here would be the "Are you sure?" the house rule refuses.
  function reopenProfile(profile: ActivityProfile): void {
    closeMutation.mutate({ id: profile.id, closed: false });
  }

  // ---------------------------------------------------------------------------
  // REMOVE IS NOW THE EXCEPTION, AND IT ONLY EVER APPEARS AT ZERO
  // ---------------------------------------------------------------------------
  // Removing an activity used to fire on ONE CLICK with no confirm at all (050-D1, found walking
  // scenario 050), and then with a confirm that could be clicked through. Migration 009 cascades
  // youth_activity_profiles → activity_events → {activity_attendees, activity_logs →
  // activity_private_notes}, so that press took a season of games, every sign-up, every follow-up
  // and the private notes rule 5 calls private forever (ITER-031).
  //
  // The control is now rendered only when `profile.eventCount === 0`, so this sentence is written
  // for the empty case and no other — the old paragraph about "every game and concert on it, past
  // ones included" described a press that can no longer happen from this page.
  //
  // THE SERVER REFUSES INDEPENDENTLY. DELETE /api/youth/profiles/[id] answers 409 when any
  // follow-up exists, naming Close as the alternative. The gate and the refusal are two
  // expressions of one rule and neither is the boundary on its own (CLAUDE.md rule 2).
  function removeProfile(profile: ActivityProfile): void {
    const confirmed = window.confirm(
      `Remove ${profile.activityName}? ` +
        "Nothing has been recorded against it yet. This cannot be undone.",
    );

    if (!confirmed) return;

    deleteMutation.mutate(profile.id);
  }

  const profiles = profilesQuery.data ?? [];
  const organizationNames = new Map(organizations.map((org) => [org.id, org.label]));

  function draftFrom(profile: ActivityProfile): ActivityProfileDraft {
    return {
      // EMPTY ON EDIT, because the roster is not edited through this form: it is its own resource
      // with its own routes and its own audit rows (RosterPanel below, and
      // lib/validation/youth.ts's updateActivityProfileSchema header). The form ignores it when
      // `initial` is supplied.
      memberIds: [],
      activityName: profile.activityName,
      activityType: profile.activityType,
      schoolOrg: profile.schoolOrg ?? "",
      seasonSchedule: profile.seasonSchedule ?? "",
      notes: profile.notes ?? "",
      orgId: profile.orgId,
    };
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">
          Activities ({activityCount(profiles.length)})
        </h2>
        {canManage ? <Button onClick={() => setCreating(true)}>Add an activity</Button> : null}
      </div>

      <FormError
        message={
          listError ??
          (profilesQuery.isError ? (profilesQuery.error as Error).message : undefined)
        }
      />

      {profiles.length === 0 ? (
        <Card>
          {/* A sentence about what the page is FOR, not a blank panel. An empty state that says
              nothing reads as a page that failed to load. */}
          <p className="text-sm text-muted">
            No youth activities have been entered yet. Record the teams, choirs and clubs the
            ward&rsquo;s young people belong to, and their games and concerts will have somewhere
            to go.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {/* ONE CARD PER TEAM, in the order listActivityProfiles returns them — by activity
              name. No grouping and no second sort: the list is already the order somebody
              scanning it expects, and a card is now the thing the page is about. */}
          {profiles.map((profile) => (
            <li key={profile.id}>
              <Card>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    {profile.activityName}
                  </h3>
                  <span
                    className={`${CHIP_CLASSES} ${
                      TONE_CLASSES[ACTIVITY_TYPE_TONES[profile.activityType]]
                    }`}
                  >
                    {ACTIVITY_TYPE_LABELS[profile.activityType]}
                  </span>

                  {/* SAID OUT LOUD ON THE CARD, because the only other sign a season is
                      finished is that its button reads `Reopen`, and a state a reader has to
                      infer from a control is not a state they have been told about.

                      NO DATE HERE. When it closed is the history page's question, and formatting
                      an instant on this screen would need the ward's zone threaded through a
                      component that has no other use for it
                      (tests/lib/explicitTimeZone.test.ts). */}
                  {profile.closedAt === null ? null : (
                    <span className={`${CHIP_CLASSES} border-border text-muted`}>
                      Season closed
                    </span>
                  )}
                </div>

                {profile.schoolOrg === null ? null : (
                  <p className="mt-1 text-sm text-muted">{profile.schoolOrg}</p>
                )}
                {profile.seasonSchedule === null ? null : (
                  <p className="text-sm text-muted">{profile.seasonSchedule}</p>
                )}
                {profile.notes === null ? null : (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                    {profile.notes}
                  </p>
                )}

                {/* WHOSE IT IS, said out loud on every card. A ward council member reads
                    activities from every organization on this page, so leaving the owner
                    implicit would make "why can I not edit this one?" unanswerable. */}
                <p className="mt-2 text-xs text-muted">
                  {profile.orgId === null
                    ? "Ward-wide"
                    : (organizationNames.get(profile.orgId) ?? "Another organization")}
                </p>

                {/* ABSENT, not disabled and not present-and-failing. `youth_activities.manage`
                    says this leader may manage activities; canManageActivityProfile says
                    WHICH, mirroring BOTH HALVES of migration 054d — USING and WITH CHECK, which
                    is the correction defect 060-D2 forced. Reads here are ward-wide by design, so
                    without this every org leader was handed Edit and Remove on every other
                    presidency's work (youth-a-D1, scenario 049).

                    IT DOES NOT GATE THE ROSTER PANEL BELOW, and that is deliberate rather than an
                    oversight: `activity_roster` carries WARD-WIDE policies on all four verbs
                    (migration 062f), so gating its controls on this helper would hide something
                    the API allows — the mirror mistake, and just as wrong. */}
                {canManage && canManageActivityProfile(user, profile) ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => setEditing(profile)}>
                      Edit
                    </Button>

                    {/* CLOSE IS THE PRIMARY ANSWER TO "I want this off my list", and it is the
                        same control in both directions — a season closed by mistake is reopened
                        by pressing what is now `Reopen`. */}
                    <Button
                      variant="secondary"
                      disabled={closeMutation.isPending}
                      onClick={() =>
                        profile.closedAt === null
                          ? closeProfile(profile)
                          : reopenProfile(profile)
                      }
                    >
                      {profile.closedAt === null ? "Close the season" : "Reopen"}
                    </Button>

                    {/* ABSENT AT ANY EVENT COUNT ABOVE ZERO, and the gate is EXACT rather than
                        an approximation — do not "improve" it into a heuristic.
                        `activity_logs.event_id` has been NOT NULL since migration 057a and
                        references `activity_events`, so an activity with no events HAS no
                        follow-ups, and this is precisely the set the server's 409 would let
                        through. Anything with a game on it is closed, never removed. */}
                    {profile.eventCount === 0 ? (
                      <Button
                        variant="danger"
                        disabled={deleteMutation.isPending}
                        onClick={() => removeProfile(profile)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                {/* THE ROSTER — the point of this slice, and the reason a card is worth opening.
                    It gates on `canManage` alone; see the comment above the ownership gate. */}
                <RosterPanel
                  profileId={profile.id}
                  activityName={profile.activityName}
                  roster={profile.roster}
                  user={user}
                  canManage={canManage}
                  pending={rosterMutation.isPending}
                  onAdd={addToRoster}
                  onSetLeavingDate={setLeavingDate}
                  onRemove={removeFromRoster}
                />
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Modal
        isOpen={creating}
        onClose={() => setCreating(false)}
        title="Add a youth activity"
      >
        <ActivityProfileForm
          user={user}
          organizations={canChooseOrganization ? organizations : undefined}
          submitLabel="Save activity"
          saving={createMutation.isPending}
          error={createMutation.isError ? (createMutation.error as Error).message : undefined}
          onSubmit={(draft) => createMutation.mutate(draft)}
          onCancel={() => setCreating(false)}
        />
      </Modal>

      <Modal
        isOpen={editing !== null}
        onClose={() => setEditing(null)}
        title="Edit this activity"
      >
        {/* Rendered only while there IS one, so the form's useState initializer re-runs against
            the profile actually being edited. A form kept mounted across two different rows shows
            the first row's draft on the second — the stale-form trap visits-d fixed with a key. */}
        {editing === null ? null : (
          <ActivityProfileForm
            user={user}
            initial={draftFrom(editing)}
            submitLabel="Save changes"
            saving={updateMutation.isPending}
            error={updateMutation.isError ? (updateMutation.error as Error).message : undefined}
            onSubmit={(draft) => updateMutation.mutate({ id: editing.id, draft })}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
    </div>
  );
}
