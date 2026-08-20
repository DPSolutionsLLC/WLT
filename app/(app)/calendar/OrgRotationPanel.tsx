"use client";

import { RotationForm } from "@/app/(app)/calendar/RotationForm";
import type { OrgLeadershipUser, RotationOrganization } from "@/lib/calendar/queries";
import type { RotationEntry } from "@/lib/calendar/resolveConductingUser";
import type { RotationCadence } from "@/types/domain";

// One organization's own conducting rotation, independent of the sacrament meeting and of every
// other organization. The page renders one of these per entry in manageableOrgIds() — a viewer
// who manages none sees none, ABSENT rather than disabled, which is what scenario 010 established
// for the bishopric rotation panel.

export type OrgRotationPanelProps = {
  organization: RotationOrganization;
  leadershipUsers: OrgLeadershipUser[];
  leadershipNames: Record<string, string>;
  activeRotation: RotationEntry[];
  activeCadence: RotationCadence;
  defaultEffectiveFrom: string;
};

export function OrgRotationPanel({
  organization,
  leadershipUsers,
  leadershipNames,
  activeRotation,
  activeCadence,
  defaultEffectiveFrom,
}: OrgRotationPanelProps) {
  // A presidency with no accounts yet is a real state — the ward has not invited them. Saying so
  // beats a form whose every select reads "Nobody" with no explanation.
  if (leadershipUsers.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nobody in {organization.name} has an account yet, so there is nobody to put in a
        rotation. An administrator can invite the presidency from the admin pages.
      </p>
    );
  }

  return (
    <RotationForm
      orgId={organization.id}
      idPrefix={`org-rotation-${organization.id}`}
      candidates={leadershipUsers.map((user) => ({
        id: user.id,
        name: leadershipNames[user.id],
      }))}
      activeRotation={activeRotation}
      activeCadence={activeCadence}
      defaultEffectiveFrom={defaultEffectiveFrom}
      notifiedDescription={`The rest of the ${organization.name} presidency have been notified of the change.`}
    />
  );
}
