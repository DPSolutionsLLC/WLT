"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import {
  CROSS_ORG_VISIBILITY_SCOPE_NOTE,
  CROSS_ORG_VISIBILITY_STATE_LABELS,
} from "@/types/domain";

// The ward's cross-org visit report visibility, as a switch.
//
// 07-visits.md calls this "a significant setting" and it is: it changes what several dozen people
// can see, in one tap, with no per-report review. So it confirms first, and the confirmation says
// IN WORDS what turning it on and off does — including the half that never changes, that
// management stays inside each organization either way. That sentence is the answer to the fear
// the switch raises, and it lives in types/domain.ts so the confirmation here and the
// notification the other two bishopric members receive cannot drift apart.
//
// THE CURRENT STATE IS ALSO TEXT, not only a switch position. A control whose meaning is carried
// entirely by which side a knob sits on is a control somebody will read backwards.

export type CrossOrgVisibilityToggleProps = {
  initialEnabled: boolean;
  // Resolved ONCE on the server and passed down. A client component never re-derives a permission
  // — it has no role access to resolve against, and a second answer that disagreed with the
  // route's would be a UI offering a control the API refuses.
  canManage: boolean;
};

export function CrossOrgVisibilityToggle({
  initialEnabled,
  canManage,
}: CrossOrgVisibilityToggleProps) {
  const [isEnabled, setIsEnabled] = useState(initialEnabled);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();

  const handleToggle = async (): Promise<void> => {
    const next = !isEnabled;

    const confirmed = window.confirm(
      next
        ? `Turn cross-organization visibility ON?\n\n${CROSS_ORG_VISIBILITY_STATE_LABELS.on}\n\n` +
            `${CROSS_ORG_VISIBILITY_SCOPE_NOTE}\n\n` +
            "Private notes are never shared, in either mode."
        : `Turn cross-organization visibility OFF?\n\n${CROSS_ORG_VISIBILITY_STATE_LABELS.off}\n\n` +
            "Leaders outside an organization will stop seeing its reports.",
    );

    if (!confirmed) return;

    setIsSaving(true);
    setErrorMessage(undefined);

    try {
      // The body key is the name lib/validation/visit.ts parses, checked against that file rather
      // than assumed (plans/retros/roster-b-picker-and-orgs.md).
      const response = await fetch("/api/ward-settings/cross-org-visibility", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ crossOrgVisibility: next }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        crossOrgVisibility?: boolean;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not save the visibility setting.");
      }

      // The SERVER'S answer, not the value that was asked for. They agree today; if a future
      // policy ever refused half of the change, the screen would show what is actually stored.
      setIsEnabled(payload.crossOrgVisibility ?? next);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not save the visibility setting. Please try again.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <h2 className="text-base font-semibold text-foreground">
        Cross-organization visit reports
      </h2>

      <p className="mt-2 text-sm text-foreground">
        <span className="font-medium">
          Currently {isEnabled ? "on" : "off"}.
        </span>{" "}
        {isEnabled
          ? CROSS_ORG_VISIBILITY_STATE_LABELS.on
          : CROSS_ORG_VISIBILITY_STATE_LABELS.off}
      </p>

      <p className="mt-2 text-sm text-muted">{CROSS_ORG_VISIBILITY_SCOPE_NOTE}</p>

      <p className="mt-2 text-sm text-muted">
        Private notes are never shared, whichever way this is set.
      </p>

      <FormError message={errorMessage} />

      {canManage ? (
        <div className="mt-3">
          <Button
            variant={isEnabled ? "secondary" : "primary"}
            onClick={handleToggle}
            disabled={isSaving}
            aria-pressed={isEnabled}
          >
            {isSaving ? "Saving…" : isEnabled ? "Turn it off" : "Turn it on"}
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">
          Only the bishop and his counselors can change this.
        </p>
      )}
    </Card>
  );
}
