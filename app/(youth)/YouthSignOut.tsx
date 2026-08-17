"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

// TopNav's sign-out cannot be reused here: it also renders the notification bell, the theme
// toggle, and the ward/role line, none of which belong in the youth shell. This is the button
// alone, so the shell itself stays a Server Component.
//
// It returns to /pin rather than /login — a youth account has no email and no password, so
// the adult sign-in form is a dead end for them.
export function YouthSignOut() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);

    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      const body: { error?: string } = await response.json();

      if (!response.ok) {
        console.error("Sign-out was refused", body.error);
        setIsSigningOut(false);
        return;
      }

      router.replace("/pin");
      router.refresh();
    } catch (error) {
      console.error("Sign-out request failed", error);
      setIsSigningOut(false);
    }
  }

  return (
    <Button variant="secondary" onClick={handleSignOut} disabled={isSigningOut}>
      {isSigningOut ? "Signing out…" : "Sign out"}
    </Button>
  );
}
