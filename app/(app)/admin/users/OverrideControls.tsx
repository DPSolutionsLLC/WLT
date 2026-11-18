"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Modal } from "@/components/ui/Modal";
import type { WardOrganization, WardUser } from "@/lib/auth/adminUsers";
import {
  INVITABLE_ROLES,
  ORG_SCOPED_ROLE_SUFFIXES,
  ROLE_LABELS,
  type Role,
} from "@/types/domain";

// THE SUPER ADMIN'S OVERRIDE ON ONE ACCOUNT (ITER-058 cr2, D3). Rendered only for the super admin.
// Saving marks the calling "Overridden — differs from the ward list", and the Calling review puts
// it back as a keep-or-clear row every time. Clearing hands the calling back to the ward list.

export type OverrideControlsProps = {
  user: WardUser;
  targetName: string;
  organizations: WardOrganization[];
};

const SELECT_CLASSES =
  "min-h-11 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60";

function needsOrganization(role: Role): boolean {
  return ORG_SCOPED_ROLE_SUFFIXES[role] !== null;
}

export function OverrideControls({ user, targetName, organizations }: OverrideControlsProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [role, setRole] = useState<Role>(user.role);
  const [orgId, setOrgId] = useState<string>(user.orgId ?? "");
  const [counselorPosition, setCounselorPosition] = useState<1 | 2>(user.counselorPosition ?? 1);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function send(method: "POST" | "DELETE", body: object, failure: string): Promise<boolean> {
    setError(undefined);
    setIsSaving(true);
    try {
      const response = await fetch("/api/callings/override", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result: { error?: string } = await response.json();
      if (!response.ok) {
        setError(result.error ?? failure);
        return false;
      }
      router.refresh();
      return true;
    } catch (caught) {
      console.error("Could not reach the server for a calling override", {
        userId: user.id,
        error: caught instanceof Error ? caught.message : String(caught),
      });
      setError("Could not reach the server. Check your connection and try again.");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function saveOverride() {
    const saved = await send(
      "POST",
      {
        userId: user.id,
        role,
        orgId: needsOrganization(role) ? orgId || null : null,
        counselorPosition: role === "counselor" ? counselorPosition : null,
      },
      "Could not override the calling. Please try again.",
    );
    if (saved) setIsOpen(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setIsOpen(true)} disabled={isSaving}>
          Override calling
        </Button>
        {user.callingSource === "override" && (
          <Button
            variant="secondary"
            disabled={isSaving}
            onClick={() =>
              void send("DELETE", { userId: user.id }, "Could not clear the override. Please try again.")
            }
          >
            Clear override
          </Button>
        )}
      </div>
      {!isOpen && <FormError message={error} />}

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title={`Override ${targetName}'s calling`}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            The calling will be marked as overridden and will come up on every Calling review until
            it is cleared.
          </p>

          <label className="flex flex-col gap-1 text-sm text-foreground">
            Calling
            <select
              className={SELECT_CLASSES}
              value={role}
              disabled={isSaving}
              onChange={(event) => setRole(event.target.value as Role)}
            >
              {INVITABLE_ROLES.map((option) => (
                <option key={option} value={option}>
                  {ROLE_LABELS[option]}
                </option>
              ))}
            </select>
          </label>

          {role === "counselor" && (
            <label className="flex flex-col gap-1 text-sm text-foreground">
              Counselor
              <select
                className={SELECT_CLASSES}
                value={counselorPosition}
                disabled={isSaving}
                onChange={(event) => setCounselorPosition(event.target.value === "2" ? 2 : 1)}
              >
                <option value="1">1st Counselor</option>
                <option value="2">2nd Counselor</option>
              </select>
            </label>
          )}

          {needsOrganization(role) && (
            <label className="flex flex-col gap-1 text-sm text-foreground">
              Organization
              <select
                className={SELECT_CLASSES}
                value={orgId}
                disabled={isSaving}
                onChange={(event) => setOrgId(event.target.value)}
              >
                <option value="">Choose an organization</option>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <FormError message={error} />

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void saveOverride()} disabled={isSaving}>
              {isSaving ? "Saving…" : "Save override"}
            </Button>
            <Button variant="secondary" onClick={() => setIsOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
