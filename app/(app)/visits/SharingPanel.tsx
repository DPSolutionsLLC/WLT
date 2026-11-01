"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import type { OrganizationType, VisitSharingGrant } from "@/types/domain";

// WHO CAN SEE EACH ORGANIZATION'S VISITS (ITER-055). The bishopric's alone — page.tsx renders this
// only when canManageVisitSharing() holds, and PUT /api/visit-sharing checks the same thing again.
//
// One row per organization, the Bishopric first: "Who can see the Elders Quorum's visits?" and a
// toggle per other organization. The Bishopric is never offered as a VIEWER — it already sees
// everything, and the route refuses that grant with a sentence.
//
// The whole set is saved at once, because the route replaces the ward's set: what is on screen is
// exactly what is stored after Save.

type SharingOrganization = { id: string; name: string; type: OrganizationType };

export type SharingPanelProps = {
  organizations: SharingOrganization[];
  initialGrants: VisitSharingGrant[];
};

function grantKey(ownerOrgId: string, viewerOrgId: string): string {
  return `${ownerOrgId}→${viewerOrgId}`;
}

function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

export function SharingPanel({ organizations, initialGrants }: SharingPanelProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialGrants.map((grant) => grantKey(grant.ownerOrgId, grant.viewerOrgId))),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);

  const owners = [...organizations].sort((first, second) => {
    if (first.type === "bishopric" && second.type !== "bishopric") return -1;
    if (second.type === "bishopric" && first.type !== "bishopric") return 1;
    return first.name.localeCompare(second.name);
  });
  const viewers = organizations.filter((organization) => organization.type !== "bishopric");

  function toggle(ownerOrgId: string, viewerOrgId: string): void {
    setSaved(false);
    setSelected((current) => {
      const next = new Set(current);
      const key = grantKey(ownerOrgId, viewerOrgId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save(): Promise<void> {
    setError(undefined);
    setSaved(false);
    setSaving(true);

    const grants: VisitSharingGrant[] = [];
    for (const owner of owners) {
      for (const viewer of viewers) {
        if (viewer.id !== owner.id && selected.has(grantKey(owner.id, viewer.id))) {
          grants.push({ ownerOrgId: owner.id, viewerOrgId: viewer.id });
        }
      }
    }

    try {
      const response = await fetch("/api/visit-sharing", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grants }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setError(body?.error ?? "Could not save who can see each organization's visits.");
        return;
      }

      setSaved(true);
      router.refresh();
    } catch (caught) {
      console.error("Saving visit sharing failed", caught);
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (organizations.length < 2) {
    return (
      <Card>
        <p className="text-sm text-muted">
          This ward has only one organization, so there is nothing to share.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <p className="text-sm text-muted">
        The bishopric always sees every organization&apos;s visits. Private notes are never shared
        with anybody.
      </p>

      <ul className="mt-4 flex flex-col gap-5">
        {owners.map((owner) => {
          const choices = viewers.filter((viewer) => viewer.id !== owner.id);
          return (
            <li key={owner.id}>
              <p className="text-sm font-medium text-foreground">
                Who can see the {possessive(owner.name)} visits?
              </p>
              <div
                role="group"
                aria-label={`Who can see the ${possessive(owner.name)} visits`}
                className="mt-2 flex flex-wrap gap-2"
              >
                {choices.map((viewer) => {
                  const isOn = selected.has(grantKey(owner.id, viewer.id));
                  return (
                    <button
                      key={viewer.id}
                      type="button"
                      aria-pressed={isOn}
                      onClick={() => toggle(owner.id, viewer.id)}
                      disabled={saving}
                      className={`min-h-11 rounded-md border px-3 text-sm ${
                        isOn
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-surface text-foreground hover:bg-surface-raised"
                      }`}
                    >
                      {viewer.name}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save sharing"}
        </Button>
        {saved ? (
          <p role="status" className="text-sm text-success">
            Saved.
          </p>
        ) : null}
      </div>
      <FormError message={error} />
    </Card>
  );
}
