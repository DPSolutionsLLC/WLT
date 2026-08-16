"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/ui/FormError";
import type { WardOrganization, WardUser } from "@/lib/auth/adminUsers";
import type { UpdateUserInput } from "@/lib/validation/adminUser";
import { INVITABLE_ROLES, ROLE_LABELS, type Role } from "@/types/domain";

export type UserRowProps = {
  user: WardUser;
  organizations: WardOrganization[];
  isSelf: boolean;
};

const SELECT_CLASSES =
  "min-h-11 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60";

export function UserRow({ user, organizations, isSelf }: UserRowProps) {
  const router = useRouter();
  const [role, setRole] = useState<Role>(user.role);
  const [orgId, setOrgId] = useState<string>(user.orgId ?? "");
  const [isActive, setIsActive] = useState(user.isActive);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();

  async function save(changes: UpdateUserInput, revert: () => void) {
    setError(undefined);
    setIsSaving(true);

    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });

      const body: { error?: string } = await response.json();

      if (!response.ok) {
        revert();
        setError(body.error ?? "Could not update the account. Please try again.");
        return;
      }

      router.refresh();
    } catch (caught) {
      console.error("Could not update the account", { userId: user.id, error: caught });
      revert();
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <li className="rounded-lg border border-border bg-surface-raised p-3 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_auto] md:items-center md:gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {fullName || user.email || user.username || "Unnamed account"}
          {isSelf && <span className="ml-2 text-xs text-muted">(you)</span>}
        </p>
        <p className="truncate text-xs text-muted">{user.email ?? user.username ?? "—"}</p>
        {user.counselorPosition && (
          <p className="text-xs text-muted">Counselor {user.counselorPosition}</p>
        )}
      </div>

      <div className="mt-3 md:mt-0">
        <label htmlFor={`role-${user.id}`} className="sr-only">
          Role for {fullName || user.email}
        </label>
        <select
          id={`role-${user.id}`}
          className={SELECT_CLASSES}
          value={role}
          // Changing your own role is disabled here: the last-bishop guard does not catch a
          // bishopric member demoting themselves while another bishop still exists, and the
          // result is a self-lockout out of the admin surface.
          disabled={isSaving || isSelf}
          onChange={(event) => {
            const previous = role;
            const next = event.target.value as Role;
            setRole(next);
            void save({ role: next }, () => setRole(previous));
          }}
        >
          {INVITABLE_ROLES.map((option) => (
            <option key={option} value={option}>
              {ROLE_LABELS[option]}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 md:mt-0">
        <label htmlFor={`organization-${user.id}`} className="sr-only">
          Organization for {fullName || user.email}
        </label>
        <select
          id={`organization-${user.id}`}
          className={SELECT_CLASSES}
          value={orgId}
          disabled={isSaving}
          onChange={(event) => {
            const previous = orgId;
            const next = event.target.value;
            setOrgId(next);
            void save({ orgId: next === "" ? null : next }, () => setOrgId(previous));
          }}
        >
          <option value="">No organization</option>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 md:mt-0">
        <button
          type="button"
          disabled={isSaving || isSelf}
          onClick={() => {
            const previous = isActive;
            const next = !isActive;
            setIsActive(next);
            void save({ isActive: next }, () => setIsActive(previous));
          }}
          className={`min-h-11 w-full rounded-md px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 md:w-auto ${
            isActive
              ? "border border-border bg-surface text-foreground hover:bg-surface-raised"
              : "bg-primary text-primary-foreground hover:opacity-90"
          }`}
        >
          {isActive ? "Deactivate" : "Reactivate"}
        </button>
      </div>

      <div className="md:col-span-4">
        <FormError message={error} />
      </div>
    </li>
  );
}
