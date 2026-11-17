"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import type { EmailCandidate } from "@/lib/callings/memberLinks";
import type { MemberLink } from "@/types/domain";

// "IS THIS YOU?" (ITER-058 cr1). A small card on the dashboard for an account not yet linked to the
// ward list in the ward it is acting in. Not dismissible: until it is linked, the roster cannot
// decide this person's calling (cr2).
//
// Three states: the account's email matches one person on the ward list (Yes / No), it does not
// (Ask the bishopric), or it has asked and is waiting. The person never browses the roster or picks
// a record — "No" falls through to asking (P4).

export type IsThisYouCardProps = {
  initialLink: MemberLink | null;
  emailCandidate: EmailCandidate | null;
};

type View = "candidate" | "ask" | "pending" | "linked";

function initialView(link: MemberLink | null, candidate: EmailCandidate | null): View {
  if (link?.status === "active") return "linked";
  if (link?.status === "pending") return "pending";
  return candidate ? "candidate" : "ask";
}

export function IsThisYouCard({ initialLink, emailCandidate }: IsThisYouCardProps) {
  const router = useRouter();
  const [view, setView] = useState<View>(() => initialView(initialLink, emailCandidate));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();

  if (view === "linked") return null;

  async function send(body: { action: "confirm"; memberId: string } | { action: "ask" }) {
    setError(undefined);
    setIsSaving(true);
    try {
      const response = await fetch("/api/member-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result: { error?: string; link?: MemberLink } = await response.json();
      if (!response.ok || !result.link) {
        setError(result.error ?? "Could not link your account. Please try again.");
        if (body.action === "confirm") setView("ask");
        return;
      }
      setView(result.link.status === "active" ? "linked" : "pending");
      router.refresh();
    } catch (caught) {
      console.error("Could not send the ward list link", {
        error: caught instanceof Error ? caught.message : String(caught),
      });
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="is-this-you-heading"
      className="rounded-lg border border-border bg-surface-raised p-3"
    >
      <h2 id="is-this-you-heading" className="text-sm font-semibold text-foreground">
        {view === "candidate" ? "Is this you?" : "Link your account to the ward list"}
      </h2>

      {view === "candidate" && emailCandidate && (
        <>
          <p className="mt-1 text-sm text-foreground">
            {emailCandidate.displayName}
            {emailCandidate.birthYear !== null && (
              <span className="text-muted">, born {emailCandidate.birthYear}</span>
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={isSaving}
              onClick={() => void send({ action: "confirm", memberId: emailCandidate.memberId })}
            >
              Yes, this is me
            </Button>
            <Button variant="secondary" disabled={isSaving} onClick={() => setView("ask")}>
              No
            </Button>
          </div>
        </>
      )}

      {view === "ask" && (
        <>
          <p className="mt-1 text-sm text-muted">
            Your account isn&apos;t linked to the ward list yet. The bishopric links it, and then
            your calling here follows the ward list.
          </p>
          <div className="mt-3">
            <Button disabled={isSaving} onClick={() => void send({ action: "ask" })}>
              Ask the bishopric to link me
            </Button>
          </div>
        </>
      )}

      {view === "pending" && (
        <p className="mt-1 text-sm text-muted">Waiting for the bishopric to link your account.</p>
      )}

      <FormError message={error} />
    </section>
  );
}
