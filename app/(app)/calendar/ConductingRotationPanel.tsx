"use client";

import { RotationForm } from "@/app/(app)/calendar/RotationForm";
import type { BishopricUser } from "@/lib/calendar/queries";
import type { RotationEntry } from "@/lib/calendar/resolveConductingUser";
import type { RotationCadence } from "@/types/domain";

// The bishopric's sacrament-meeting rotation — `orgId: null` (migration 024, Part 2). The form
// itself lives in RotationForm, which OrgRotationPanel renders too, so the forward-only sentence
// and the 409 handling exist once.

export type ConductingRotationPanelProps = {
  bishopricUsers: BishopricUser[];
  bishopricNames: Record<string, string>;
  activeRotation: RotationEntry[];
  activeCadence: RotationCadence;
  // The next Sunday, resolved on the server in UTC. A date input default computed in the browser
  // would offer yesterday to anyone west of UTC after 5pm.
  defaultEffectiveFrom: string;
};

export function ConductingRotationPanel({
  bishopricUsers,
  bishopricNames,
  activeRotation,
  activeCadence,
  defaultEffectiveFrom,
}: ConductingRotationPanelProps) {
  return (
    <RotationForm
      orgId={null}
      idPrefix="rotation"
      candidates={bishopricUsers.map((user) => ({
        id: user.id,
        name: bishopricNames[user.id],
      }))}
      activeRotation={activeRotation}
      activeCadence={activeCadence}
      defaultEffectiveFrom={defaultEffectiveFrom}
      notifiedDescription="The other members of the bishopric have been notified of the change."
    />
  );
}
