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
  PROFILE_MUTATION_INVALIDATES,
  YOUTH_PROFILES_QUERY_KEY,
  errorFrom,
  fetchProfiles,
  readJson,
} from "@/app/(app)/youth/youthQueries";
import { canManageActivityProfile } from "@/lib/youth/activityOwnership";
import type { ActivityProfile } from "@/lib/youth/queries";
import {
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_TYPE_TONES,
  type ContextTone,
  type SessionUser,
} from "@/types/domain";

// The activities on the ward's youth, GROUPED BY THE YOUTH. 08-youth-activities.md's first line
// is that one young person can be on a team AND in a choir AND on the debate squad, so a flat
// list of activities would show the same name three times and answer "who is this about?" three
// times too.
//
// PAGE.TSX IMPORTS ONLY THE COMPONENT FROM THIS FILE. A constant imported from a "use client"
// module reaches a Server Component as a function rather than as a string — the bug that made
// visits-d's "Log this visit" flow silently dead. The shared cache keys live in
// app/(app)/youth/youthQueries.ts, which the server never imports.
//
// WHICH activities carry Edit and Remove is decided by canManageActivityProfile(), which mirrors
// migration 054d. Gating on `canManage` alone put both buttons on every organization's work and
// is defect youth-a-D1 (plans/retros, scenario 049).

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

// Grouped in render order rather than sorted again here: listActivityProfiles already orders by
// activity name, so a youth's activities arrive in a stable order and only the grouping is left.
// The youth are then ordered by name, which is the order somebody scanning a list expects.
function groupByYouth(
  profiles: readonly ActivityProfile[],
): { memberId: string; memberName: string; profiles: ActivityProfile[] }[] {
  const groups = new Map<string, { memberId: string; memberName: string; profiles: ActivityProfile[] }>();

  for (const profile of profiles) {
    const existing = groups.get(profile.memberId);

    if (existing === undefined) {
      groups.set(profile.memberId, {
        memberId: profile.memberId,
        memberName: profile.memberName,
        profiles: [profile],
      });
    } else {
      existing.profiles.push(profile);
    }
  }

  return [...groups.values()].sort((left, right) =>
    left.memberName.localeCompare(right.memberName),
  );
}

// A count in a sentence needs a singular case, and a fixture with one of everything cannot catch
// the missing one (plans/retros/ai-b-*: "all 1 of its passages").
function activityCount(count: number): string {
  return count === 1 ? "1 activity" : `${count} activities`;
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
  async function refresh(): Promise<void> {
    await Promise.all(
      PROFILE_MUTATION_INVALIDATES.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey: [...queryKey] }),
      ),
    );
  }

  const createMutation = useMutation({
    mutationFn: async (draft: ActivityProfileDraft) => {
      const response = await fetch("/api/youth/profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          memberId: draft.memberId,
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

  const profiles = profilesQuery.data ?? [];
  const groups = groupByYouth(profiles);
  const organizationNames = new Map(organizations.map((org) => [org.id, org.label]));

  function draftFrom(profile: ActivityProfile): ActivityProfileDraft {
    return {
      memberId: profile.memberId,
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

      {groups.length === 0 ? (
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
          {groups.map((group) => (
            <li key={group.memberId}>
              <Card>
                {/* ONE PERSON, ONCE, with their activities beneath. A youth with two activities
                    is one heading and two cards, never the same name twice. */}
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{group.memberName}</h3>
                  <span className="text-xs text-muted">
                    {activityCount(group.profiles.length)}
                  </span>
                </div>

                <ul className="mt-3 flex flex-col gap-3">
                  {group.profiles.map((profile) => (
                    <li
                      key={profile.id}
                      className="rounded-md border border-border bg-surface p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {profile.activityName}
                        </span>
                        <span
                          className={`${CHIP_CLASSES} ${
                            TONE_CLASSES[ACTIVITY_TYPE_TONES[profile.activityType]]
                          }`}
                        >
                          {ACTIVITY_TYPE_LABELS[profile.activityType]}
                        </span>
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
                          WHICH, mirroring migration 054d. Reads here are ward-wide by design, so
                          without this every org leader was handed Edit and Remove on every other
                          presidency's work — RLS refused the writes, but a destructive-sounding
                          control that always fails is still a bug (youth-a-D1, scenario 049). */}
                      {canManage && canManageActivityProfile(user, profile) ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button variant="secondary" onClick={() => setEditing(profile)}>
                            Edit
                          </Button>
                          <Button
                            variant="danger"
                            disabled={deleteMutation.isPending}
                            onClick={() => deleteMutation.mutate(profile.id)}
                          >
                            Remove
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
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
