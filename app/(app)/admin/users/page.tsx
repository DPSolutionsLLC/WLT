import { CallingReview } from "@/app/(app)/admin/users/CallingReview";
import { CallingsWithoutAccount } from "@/app/(app)/admin/users/CallingsWithoutAccount";
import { InviteForm, type InviteCandidate } from "@/app/(app)/admin/users/InviteForm";
import { MemberLinkControls } from "@/app/(app)/admin/users/MemberLinkControls";
import { OverrideControls } from "@/app/(app)/admin/users/OverrideControls";
import { UserRow } from "@/app/(app)/admin/users/UserRow";
import { YouthAccountForm } from "@/app/(app)/admin/users/YouthAccountForm";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { displayName, listWardOrganizations, listWardUsers } from "@/lib/auth/adminUsers";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { describeTarget } from "@/lib/callings/callingReview";
import { canManageMemberLinks, roleNeedsRosterLink } from "@/lib/callings/linkAccess";
import { loadCallingReview, loadUnlinkedHolders } from "@/lib/callings/loadCallingReview";
import { listOpenWardLinks } from "@/lib/callings/memberLinks";
import { listYouthAccounts } from "@/lib/auth/youthAccounts";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

// The layout above already gated on admin.view. This second check is not redundant: Phase 11's
// Role Access page can widen admin.view without widening admin.manage_users.
export default async function AdminUsersPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

  if (!can(user, "admin.manage_users", roleAccess)) {
    return <NotPermitted detail="Managing accounts is limited to the bishopric." />;
  }

  const canLink = canManageMemberLinks(user, roleAccess);

  // The links and the Calling review (ITER-058 cr2) read through the service role AFTER
  // canManageMemberLinks(): a super admin acting under a `super_admin` calling is not admitted to
  // the ward's links by policy, and that check is the boundary (lib/callings/loadCallingReview.ts).
  // Read through the caller's client, every row read "Not linked" for them (defect 103b-D1).
  const linkClient = canLink ? createServiceSupabaseClient() : supabase;

  const [users, organizations, youthAccounts, links] = await Promise.all([
    listWardUsers(user.wardId, supabase),
    listWardOrganizations(user.wardId, supabase),
    listYouthAccounts(user.wardId, supabase),
    listOpenWardLinks(user.wardId, linkClient),
  ]);

  const [review, unlinkedHolders] = canLink
    ? await Promise.all([
        loadCallingReview(user.wardId, linkClient),
        loadUnlinkedHolders(user.wardId, linkClient),
      ])
    : [null, []];
  const usersWithPendingReview = new Set(review?.rows.map((row) => row.userId) ?? []);
  const organizationNames = new Map(organizations.map((organization) => [organization.id, organization.name]));

  const linksByUser = new Map(links.map((link) => [link.userId, link]));
  const usersById = new Map(users.map((wardUser) => [wardUser.id, wardUser]));

  // Marks who is already taken in the picker (walking scenario 103). Marked, not hidden: the
  // bishop can still see why a person they expected is not the right pick.
  const linkedMemberNotes: Record<string, string> = {};
  for (const link of links) {
    if (link.status !== "active" || link.memberId === null) continue;
    const holder = usersById.get(link.userId);
    linkedMemberNotes[link.memberId] = holder
      ? `Linked to ${displayName(holder)}'s account`
      : "Linked to another account";
  }

  // WHO CAN BE INVITED, AND WHY NOT (ITER-058 cr4). The calling an invite leads to is worked out
  // here, from the same title map, so the form names it the moment a person is picked; the server
  // works it out again when the invite is made and again when it is redeemed.
  const inviteCandidates: Record<string, InviteCandidate> = {};
  const inviteRefusals: Record<string, string> = {};
  const invitePickerNotes: Record<string, string> = { ...linkedMemberNotes };
  for (const link of links) {
    if (link.status !== "active" || link.memberId === null) continue;
    inviteRefusals[link.memberId] =
      `${link.memberName ?? "This person"} already has an account linked to the ward list. They can sign in as they are.`;
  }
  for (const holder of unlinkedHolders) {
    if (holder.state === "maybe_account") {
      inviteRefusals[holder.memberId] =
        `${holder.possibleAccountName ?? "An account"} may be ${holder.memberName} already. Link that account on its row instead of sending an invite.`;
      invitePickerNotes[holder.memberId] = `May be ${holder.possibleAccountName ?? "an account"} already`;
      continue;
    }
    inviteCandidates[holder.memberId] = {
      memberName: holder.memberName,
      email: holder.email,
      callingLabel: holder.callingLabel,
    };
  }

  // Youth accounts get their own section below, so the adult list does not show rows with no
  // email, no organization, and controls that do not apply to them.
  const adultUsers = users.filter((wardUser) => wardUser.role !== "sacrament_manager");

  // Requests to be linked sit at the top, so they are acted on rather than found (ITER-058 cr1).
  const waitingUsers = adultUsers.filter(
    (wardUser) => linksByUser.get(wardUser.id)?.status === "pending" && wardUser.id !== user.id,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Users</h1>
        <p className="mt-1 text-sm text-muted">
          {users.length} {users.length === 1 ? "account" : "accounts"} in this ward
          {youthAccounts.length > 0 &&
            `, ${youthAccounts.length} of them youth ${
              youthAccounts.length === 1 ? "account" : "accounts"
            }`}
          .
        </p>
      </div>

      {canLink && waitingUsers.length > 0 && (
        <section aria-labelledby="link-requests-heading" className="flex flex-col gap-2">
          <h2 id="link-requests-heading" className="text-sm font-semibold text-foreground">
            Waiting to be linked to the ward list
          </h2>
          <ul className="flex flex-col gap-2">
            {waitingUsers.map((wardUser) => (
              <li
                key={wardUser.id}
                className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3"
              >
                <p className="text-sm text-foreground">{displayName(wardUser)} asked to be linked.</p>
                <MemberLinkControls
                  sessionUser={user}
                  targetUserId={wardUser.id}
                  targetName={displayName(wardUser)}
                  linkId={linksByUser.get(wardUser.id)?.id ?? null}
                  linkStatus="pending"
                  linkedMemberNotes={linkedMemberNotes}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Mounted even with no rows, so Apply clearing the last of them keeps its result on screen;
          the review hides itself when there is nothing to show (defect 103b-D2). */}
      {review && (
        <CallingReview
          rows={review.rows}
          actorUserId={user.id}
          actorIsSuperAdmin={user.isSuperAdmin}
        />
      )}

      {canLink ? (
        <>
          <CallingsWithoutAccount
            holders={unlinkedHolders}
            sessionUser={user}
            candidates={inviteCandidates}
            refusals={inviteRefusals}
            pickerNotes={invitePickerNotes}
          />
          <InviteForm
            sessionUser={user}
            candidates={inviteCandidates}
            refusals={inviteRefusals}
            pickerNotes={invitePickerNotes}
          />
        </>
      ) : (
        <p className="text-sm text-muted">Inviting people is limited to the bishopric.</p>
      )}

      {/* One list at every width: stacked cards on a phone, aligned columns from md up. A
          table that scrolls sideways at 375px is not usable. */}
      <section className="flex flex-col gap-3">
        <div className="hidden px-3 text-xs font-medium text-muted md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto] md:gap-3">
          <span>Name</span>
          <span>Calling</span>
          <span>Status</span>
        </div>

        <ul className="flex flex-col gap-3">
          {adultUsers.map((wardUser) => (
            <UserRow
              key={wardUser.id}
              user={wardUser}
              callingLabel={describeTarget(wardUser, organizationNames)}
              isSelf={wardUser.id === user.id}
              reviewPending={usersWithPendingReview.has(wardUser.id)}
              overrideControls={
                user.isSuperAdmin && roleNeedsRosterLink(wardUser.role) ? (
                  <OverrideControls
                    user={wardUser}
                    targetName={displayName(wardUser)}
                    organizations={organizations}
                  />
                ) : null
              }
              link={linksByUser.get(wardUser.id) ?? null}
              linkControls={
                canLink && wardUser.id !== user.id && roleNeedsRosterLink(wardUser.role) ? (
                  <MemberLinkControls
                    sessionUser={user}
                    targetUserId={wardUser.id}
                    targetName={displayName(wardUser)}
                    linkId={linksByUser.get(wardUser.id)?.id ?? null}
                    linkStatus={linksByUser.get(wardUser.id)?.status ?? null}
                    linkedMemberNotes={linkedMemberNotes}
                  />
                ) : null
              }
            />
          ))}
        </ul>
      </section>

      <YouthAccountForm accounts={youthAccounts} />
    </div>
  );
}
