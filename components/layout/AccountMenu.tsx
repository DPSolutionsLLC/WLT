"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WardSwitcher } from "@/components/layout/WardSwitcher";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { SessionUser } from "@/types/domain";

// Who you are, which ward you are acting in, and the way out. Everything TopNav used to carry,
// in a menu rather than strung across the bar — a phone is 375px wide. The theme button moved
// onto the bar itself (ITER-047), so there is one theme control and two copies cannot disagree.
//
// ---------------------------------------------------------------------------
// IT DOES NOT LINK TO /account
// ---------------------------------------------------------------------------
// The Account page is P8's and does not exist yet. Linking to it would be precisely the
// dead-link bug this phase closes — an offered control that 404s. P8 attaches its link HERE,
// beside the name, and flips nothing else.
//
// BUILT ON Modal, so focus trapping, Escape, the backdrop, the inertness of the page behind and
// focus returning to the trigger all come from the platform's <dialog>. Every one of those is a
// bug waiting to happen when hand-written, and three of them are things a screen-reader user
// notices first.

export type AccountMenuProps = {
  user: SessionUser;
  callingLabel: string;
  wardName: string;
};

export function AccountMenu({ user, callingLabel, wardName }: AccountMenuProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "Signed in";

  // Lifted out of TopNav verbatim.
  async function handleSignOut(): Promise<void> {
    setIsSigningOut(true);

    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      const body: { redirectTo?: string; error?: string } = await response.json();

      if (!response.ok) {
        console.error("Sign-out was refused", body.error);
        setIsSigningOut(false);
        return;
      }

      router.replace(body.redirectTo ?? "/login");
      router.refresh();
    } catch (error) {
      console.error("Sign-out request failed", error);
      setIsSigningOut(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md px-2 text-sm font-medium text-foreground hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span className="sr-only">Your account</span>
        <span aria-hidden="true" className="text-lg">
          ☰
        </span>
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Your account">
        <div className="flex flex-col gap-5">
          <div>
            <p className="font-display text-base font-semibold text-foreground">{displayName}</p>
            {/* NAMES THE ORGANIZATION, not just the role — "Relief Society President", never the
                bare "Organization President" the walk of scenario 066 found too vague to act on.
                Under the calling model this is also what tells somebody holding callings in two
                wards WHICH ONE is active. */}
            <p className="text-sm text-muted">
              {callingLabel} · {wardName}
            </p>
          </div>

          {/* ITER-041. The chrome bar's "Admin view" pill has no room on a phone, so the notice
              lives here too. Shown at every width: the menu is where a person checks who they are
              acting as, and the line costs nothing on a wide screen. */}
          {user.isSuperAdmin && user.releasedModules !== null ? (
            <p className="text-sm text-muted">
              <span className="font-medium text-foreground">Admin view.</span> You see modules
              this ward has not released.
            </p>
          ) : null}

          {/* Renders nothing at all for the great majority of people, who hold one calling. */}
          <WardSwitcher />

          <Button variant="secondary" onClick={() => void handleSignOut()} disabled={isSigningOut}>
            {isSigningOut ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
