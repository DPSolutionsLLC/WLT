"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Button } from "@/components/ui/Button";
import type { SessionUser } from "@/types/domain";

export type TopNavProps = {
  user: SessionUser;
  wardName: string;
  roleLabel: string;
};

export function TopNav({ user, wardName, roleLabel }: TopNavProps) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.username ||
    "Signed in";

  async function handleSignOut() {
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
    <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{wardName}</p>
        <p className="truncate text-xs text-muted">
          {displayName} · {roleLabel}
        </p>
      </div>

      <NotificationBell />
      <ThemeToggle initialPreference={user.themePreference} />

      <Button variant="secondary" onClick={handleSignOut} disabled={isSigningOut}>
        {isSigningOut ? "Signing out…" : "Sign out"}
      </Button>
    </header>
  );
}
