"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FormError } from "@/components/ui/FormError";
import type { WardUser } from "@/lib/auth/adminUsers";
import type { WardLinkSummary } from "@/lib/callings/memberLinks";
import type { UpdateUserInput } from "@/lib/validation/adminUser";

// ONE ACCOUNT ON ADMIN → USERS. Since ITER-058 cr2 a row no longer sets a calling: a linked
// account's calling follows the ward list through the Calling review above the list, and the only
// hand edit left is the super admin's marked override (`overrideControls`). What a row still does
// is show the calling and where it came from, and switch the account on or off.

export type UserRowProps = {
  user: WardUser;
  callingLabel: string;
  isSelf: boolean;
  link: WardLinkSummary | null;
  linkControls: ReactNode;
  overrideControls: ReactNode;
  reviewPending: boolean;
};

function describeLink(link: WardLinkSummary | null): string {
  if (link?.status === "active") return `Linked to ${link.memberName ?? "someone on the ward list"}`;
  if (link?.status === "pending") return "Waiting to be linked";
  return "Not linked to the ward list";
}

const REVIEW_PENDING_NOTE = "Change waiting in the Calling review";

// An override always has a review row, so the pending note would add nothing there (walking
// scenario 103b, question 5).
function describeSource(user: WardUser, link: WardLinkSummary | null, reviewPending: boolean): string {
  if (user.callingSource === "override") return "Overridden — differs from the ward list";
  const source =
    user.callingSource === "roster"
      ? "From the ward list"
      : link?.status === "active"
        ? "Set by hand"
        : "Set by hand (not linked)";
  return reviewPending ? `${source} · ${REVIEW_PENDING_NOTE}` : source;
}

export function UserRow({
  user,
  callingLabel,
  isSelf,
  link,
  linkControls,
  overrideControls,
  reviewPending,
}: UserRowProps) {
  const router = useRouter();
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
      console.error("Could not update the account", {
        userId: user.id,
        error: caught instanceof Error ? caught.message : String(caught),
      });
      revert();
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <li className="rounded-lg border border-border bg-surface-raised p-3 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto] md:items-center md:gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {fullName || user.email || user.username || "Unnamed account"}
          {isSelf && <span className="ml-2 text-xs text-muted">(you)</span>}
        </p>
        <p className="truncate text-xs text-muted">{user.email ?? user.username ?? "—"}</p>
        <p className="text-xs text-muted">{describeLink(link)}</p>
      </div>

      <div className="mt-3 min-w-0 md:mt-0">
        <p className="text-sm text-foreground">{callingLabel}</p>
        <p
          className={`text-xs ${user.callingSource === "override" ? "font-medium text-warning" : "text-muted"}`}
        >
          {describeSource(user, link, reviewPending)}
        </p>
      </div>

      <div className="mt-3 md:mt-0">
        <button
          type="button"
          // Deactivating your own account is also refused by the server (ITER-058 cr2).
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

      {(linkControls || overrideControls) && (
        <div className="mt-3 flex flex-col gap-2 md:col-span-3 md:mt-0">
          {linkControls}
          {overrideControls}
        </div>
      )}

      <div className="md:col-span-3">
        <FormError message={error} />
      </div>
    </li>
  );
}
