"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";

// Sign-out for /no-calling. AccountMenu cannot be reused: it lives in the (app) chrome, which is
// exactly what cannot render for an account with no calling.
export function NoCallingSignOut() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSignOut() {
    setError(undefined);
    setIsSigningOut(true);

    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      const body: { error?: string } = await response.json();

      if (!response.ok) {
        setError(body.error ?? "Could not sign you out. Please try again.");
        setIsSigningOut(false);
        return;
      }

      router.replace("/login");
      router.refresh();
    } catch (caught) {
      console.error("Sign-out request failed", {
        error: caught instanceof Error ? caught.message : String(caught),
      });
      setError("Could not reach the server. Check your connection and try again.");
      setIsSigningOut(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={() => void handleSignOut()} disabled={isSigningOut}>
        {isSigningOut ? "Signing out…" : "Sign out"}
      </Button>
      <FormError message={error} />
    </div>
  );
}
