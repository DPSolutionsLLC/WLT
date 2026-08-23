import { CalendarSettingsPanel } from "@/app/(app)/calendar/CalendarSettingsPanel";
import { ConductingRotationPanel } from "@/app/(app)/calendar/ConductingRotationPanel";
import { MonthNavigation } from "@/app/(app)/calendar/MonthNavigation";
import { OrgRotationPanel } from "@/app/(app)/calendar/OrgRotationPanel";
import { PipelineStatusSummary } from "@/components/assignments/PipelineStatusSummary";
import { SpeakerList } from "@/components/assignments/SpeakerList";
import { MonthGrid } from "@/components/calendar/MonthGrid";
import { SundayCard } from "@/components/calendar/SundayCard";
import type { SundayReservedRegions } from "@/components/calendar/SundayCell";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { listAssignments, type Assignment } from "@/lib/assignments/queries";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import {
  addDaysUtc,
  firstSundayOnOrAfter,
  formatDateOnly,
  lastDayOfMonth,
  monthLabel,
  monthStart,
  parseMonthParam,
} from "@/lib/calendar/dates";
import { manageableOrgIds } from "@/lib/calendar/orgRotationScope";
import {
  conductingNameMap,
  ensureMonthGenerated,
  listBishopricUsers,
  listConductingRotation,
  listOrgLeadershipUsers,
  listRotationOrganizations,
  listSundays,
  type ConductingRotationRow,
} from "@/lib/calendar/queries";
import {
  activeRotation,
  type RotationEntry,
} from "@/lib/calendar/resolveConductingUser";
import { readDefaultSpeakingSlots } from "@/lib/calendar/wardCalendarSettings";
import { listMembers } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { MAX_SPEAKING_SLOTS } from "@/lib/validation/calendar";
import { MEMBER_STATUSES } from "@/types/domain";

// searchParams is a Promise in Next 16, typed explicitly rather than with the generated PageProps
// helper — that only exists after a build (plans/retros/foundation-a-scaffold.md).
export type CalendarPageProps = {
  searchParams: Promise<{ month?: string }>;
};

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  // can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500
  // whose message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
  if (!can(user, "calendar.view", roleAccess)) {
    return <NotPermitted detail="The ward calendar is limited to ward leadership." />;
  }

  // Two different gates, not one (calendar-a Decision 5). A ward_secretary maintains the calendar;
  // only the bishopric decides who conducts and what a new Sunday starts with.
  const canManage = can(user, "calendar.manage", roleAccess);
  const canManageRotation = can(user, "admin.manage_ward", roleAccess);

  // A third gate. Who conducts is calendar data; who is SPEAKING is talk-pipeline data, and the
  // Sunday detail page has gated its Speakers section on talks.view since calendar-b.
  const canSeeSpeakers = can(user, "talks.view", roleAccess);

  // Today in UTC, matching how every date in this module is read, and resolved HERE so the month
  // helpers stay pure and the client components never construct a date of their own.
  const today = formatDateOnly(new Date());
  const params = await searchParams;
  const month = parseMonthParam(params.month, today);
  const range = { from: month, to: lastDayOfMonth(month) };

  // Generation is a WRITE, so it only runs for somebody the route layer would let write. Migration
  // 019 grants UPDATE and INSERT on `sundays` to every authenticated member of the ward, so RLS
  // would happily let a music coordinator generate a month by opening it — and a read-only page
  // that quietly writes is a surprise nobody asked for. They see an empty month and who to ask.
  const sundays = canManage
    ? await ensureMonthGenerated(user.wardId, month, supabase)
    : await listSundays(user.wardId, range, supabase);

  const [rotation, bishopricUsers, organizations, orgLeadershipUsers, defaultSpeakingSlots] =
    await Promise.all([
      // Every rotation in the ward — the bishopric's and each organization's — in one read.
      listConductingRotation(user.wardId, {}, supabase),
      listBishopricUsers(user.wardId, supabase),
      listRotationOrganizations(user.wardId, supabase),
      listOrgLeadershipUsers(user.wardId, undefined, supabase),
      readDefaultSpeakingSlots(user.wardId, supabase),
    ]);

  const conductingNames = conductingNameMap(bishopricUsers);
  const orgLeadershipNames = conductingNameMap(orgLeadershipUsers);

  // The month's assignments in ONE read, plus one roster read to turn member ids into names.
  // Both are skipped entirely for a viewer without talks.view rather than fetched and hidden.
  const [monthAssignments, speakerNames] = canSeeSpeakers
    ? await Promise.all([
        listAssignments(user.wardId, range, supabase),
        readSpeakerNames(user.wardId, supabase),
      ])
    : [[] as Assignment[], {} as Record<string, string>];

  const reservedRegions = canSeeSpeakers
    ? buildReservedRegions(sundays, monthAssignments, speakerNames)
    : undefined;

  // The rotation panels are rendered for organizations this viewer may MANAGE, and for nobody
  // else — absent, not disabled. manageableOrgIds() is the second of two boundaries; migration
  // 024's policies are the first (lib/calendar/orgRotationScope.ts).
  const manageableIds = new Set(manageableOrgIds(user, organizations, roleAccess));
  const manageableOrganizations = organizations.filter((organization) =>
    manageableIds.has(organization.id),
  );

  const currentRotation = activeRotationFor(rotation, null, today);
  const defaultEffectiveFrom = firstSundayOnOrAfter(addDaysUtc(today, 1));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{monthLabel(month)}</h1>
          <p className="mt-1 text-sm text-muted">
            {sundays.length} {sundays.length === 1 ? "Sunday" : "Sundays"}
          </p>
        </div>

        <MonthNavigation monthStart={month} currentMonthStart={monthStart(today)} />
      </div>

      {sundays.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            This month has not been added to the calendar yet. A member of the bishopric or the
            ward secretary can create it by opening this month.
          </p>
        </Card>
      ) : (
        <>
          {/* Same data, two layouts (03-calendar.md Step 5). A month grid at 375px is unusable. */}
          <div className="hidden md:block">
            <MonthGrid
              monthStart={month}
              sundays={sundays}
              conductingNames={conductingNames}
              regionsBySundayId={reservedRegions}
            />
          </div>

          <div className="flex flex-col gap-3 md:hidden">
            {sundays.map((sunday) => (
              <SundayCard
                key={sunday.id}
                sunday={sunday}
                conductingNames={conductingNames}
                speakers={reservedRegions?.[sunday.id]?.speakers}
                pipelineStatus={reservedRegions?.[sunday.id]?.pipelineStatus}
              />
            ))}
          </div>
        </>
      )}

      {/* Set-once controls, collapsed, like the roster's add-household panel. */}
      <div className="flex flex-col gap-3">
        {manageableOrganizations.map((organization) => {
          const organizationRotation = activeRotationFor(rotation, organization.id, today);

          return (
            <Card key={organization.id}>
              <details>
                <summary className="min-h-11 cursor-pointer list-none text-sm font-semibold text-foreground">
                  {organization.name} conducting rotation
                </summary>
                <div className="mt-3 border-t border-border pt-3">
                  <OrgRotationPanel
                    organization={organization}
                    leadershipUsers={orgLeadershipUsers.filter(
                      (leader) => leader.orgId === organization.id,
                    )}
                    leadershipNames={orgLeadershipNames}
                    activeRotation={organizationRotation}
                    activeCadence={organizationRotation[0]?.cadence ?? "weekly"}
                    defaultEffectiveFrom={defaultEffectiveFrom}
                  />
                </div>
              </details>
            </Card>
          );
        })}

        {canManageRotation && (
          <Card>
            <details>
              <summary className="min-h-11 cursor-pointer list-none text-sm font-semibold text-foreground">
                Conducting rotation
              </summary>
              <div className="mt-3 border-t border-border pt-3">
                <ConductingRotationPanel
                  bishopricUsers={bishopricUsers}
                  bishopricNames={conductingNames}
                  activeRotation={currentRotation}
                  activeCadence={currentRotation[0]?.cadence ?? "weekly"}
                  defaultEffectiveFrom={defaultEffectiveFrom}
                />
              </div>
            </details>
          </Card>
        )}

        <Card>
          <details>
            <summary className="min-h-11 cursor-pointer list-none text-sm font-semibold text-foreground">
              Calendar settings
            </summary>
            <div className="mt-3 border-t border-border pt-3">
              <CalendarSettingsPanel
                defaultSpeakingSlots={defaultSpeakingSlots}
                maxSpeakingSlots={MAX_SPEAKING_SLOTS}
                canManage={canManageRotation}
              />
            </div>
          </details>
        </Card>
      </div>
    </div>
  );
}

// Every member the ward has ever had, not only the active ones. An assignment can name somebody
// who has since moved out, and dropping their name would render the slot as "open" — which
// reads as a planning gap rather than as a speaker who is gone.
async function readSpeakerNames(
  wardId: string,
  client: Awaited<ReturnType<typeof createServerSupabaseClient>>,
): Promise<Record<string, string>> {
  const members = await listMembers(wardId, { statuses: MEMBER_STATUSES }, client);

  return Object.fromEntries(
    members.map((member) => [member.id, `${member.firstName} ${member.lastName}`.trim()]),
  );
}

// TWO of the three reserved regions, built once from one read. `goalAlerts` is deliberately left
// unset.
//
// It WAS filled here, and was taken back out after scenario 019 was walked: three overdue goals
// wrap to nine lines in a ~130px grid column, and stacked under the speakers and the pipeline
// summary they read as clutter rather than as information. The alerts now live on the Sunday
// planning page, where somebody has already decided to work on that Sunday and the warning has a
// job to do — components/goals/GoalAlertBanner.tsx.
//
// So the third region stays OPEN. calendar-b sized `min-h-40` for three regions and it was never
// the constraint that failed; what failed was the density of this particular content at this
// particular width. A later slice with something terser to say may still fill it.
function buildReservedRegions(
  sundays: { id: string; speakingSlots: number }[],
  assignments: Assignment[],
  memberNames: Record<string, string>,
): Record<string, SundayReservedRegions> {
  const bySunday = new Map<string, Assignment[]>();

  for (const assignment of assignments) {
    if (assignment.sundayId === null) continue;
    bySunday.set(assignment.sundayId, [
      ...(bySunday.get(assignment.sundayId) ?? []),
      assignment,
    ]);
  }

  return Object.fromEntries(
    sundays.map((sunday) => {
      const forSunday = bySunday.get(sunday.id) ?? [];

      return [
        sunday.id,
        {
          speakers: (
            <SpeakerList
              speakingSlots={sunday.speakingSlots}
              assignments={forSunday}
              memberNames={memberNames}
            />
          ),
          pipelineStatus: (
            <PipelineStatusSummary
              stages={forSunday.map((assignment) => assignment.stage)}
            />
          ),
        },
      ];
    }),
  );
}

// The set of three rows in force TODAY for one rotation. `orgId: null` is the bishopric's
// sacrament-meeting rotation; a uuid is that organization's. Rows for other rotations are
// filtered out FIRST — activeRotation() picks the latest effective_from across whatever it is
// given, so mixing two rotations would let the Elders Quorum's newer set hide the bishopric's.
function activeRotationFor(
  rows: ConductingRotationRow[],
  orgId: string | null,
  today: string,
): RotationEntry[] {
  return activeRotation(
    rows
      .filter((row) => row.orgId === orgId)
      .map((row) => ({
        position: row.position,
        userId: row.userId,
        effectiveFrom: row.effectiveFrom,
        cadence: row.cadence,
      })),
    today,
  );
}
