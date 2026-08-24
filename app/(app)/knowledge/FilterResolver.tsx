"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { MAX_FILTER_LABEL, MAX_FILTER_PHRASE } from "@/lib/validation/knowledge";
import type { ResolvedFilter } from "@/types/domain";

// PROPOSE, SHOW, ACCEPT. Typing a phrase asks the model for a filter; the sentence it produced is
// shown; nothing is stored until somebody presses Save. That is CLAUDE.md rule 3 applied to a
// filter instead of a topic, and it is the same shape `topic_candidates` uses.
//
// Rejecting leaves NOTHING behind — there is no draft row, no pending record, and no second
// endpoint to clean up. /api/knowledge/filters/resolve writes nothing at all.

type ResolveResponse = {
  filter?: ResolvedFilter;
  description?: string | null;
  error?: string;
};

export type FilterResolverProps = {
  canManage: boolean;
};

export function FilterResolver({ canManage }: FilterResolverProps) {
  const router = useRouter();

  const [phrase, setPhrase] = useState("");
  const [proposal, setProposal] = useState<ResolvedFilter>();
  const [description, setDescription] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [resolveError, setResolveError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [isResolving, setIsResolving] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  if (!canManage) return null;

  function clearProposal() {
    setProposal(undefined);
    setDescription(null);
    setLabel("");
    setSaveError(undefined);
  }

  async function handleResolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResolveError(undefined);
    // Cleared before the call, so a failure never leaves the PREVIOUS proposal on screen looking
    // like the answer to the phrase that just failed.
    clearProposal();
    setIsResolving(true);

    try {
      const response = await fetch("/api/knowledge/filters/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase }),
      });

      const body: ResolveResponse = await response.json();

      if (!response.ok || !body.filter) {
        setResolveError(body.error ?? "Could not work out a filter from that. Try again.");
        return;
      }

      setProposal(body.filter);
      setDescription(body.description ?? null);
      if (body.filter.kind === "filter") setLabel(body.filter.label);
    } catch (error) {
      console.error("Could not resolve a retrieval filter", error);
      setResolveError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsResolving(false);
    }
  }

  async function handleAccept() {
    if (proposal?.kind !== "filter") return;

    setSaveError(undefined);
    setIsSaving(true);

    try {
      const response = await fetch("/api/knowledge/filters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The RESOLVED AXES, not the phrase. What gets stored is exactly what was on screen when
        // the button was pressed — a route that re-ran the model at accept time could save
        // something the user never read.
        body: JSON.stringify({
          label,
          sourcePhrase: phrase,
          speakerRoles: proposal.speakerRoles,
          speakers: proposal.speakers,
          since: proposal.since,
        }),
      });

      const body: { error?: string } = await response.json();

      if (!response.ok) {
        // A DUPLICATE LABEL ARRIVES HERE AS A SENTENCE, not a 500 — the route turns migration
        // 034's unique violation into something the person who typed the name can act on.
        setSaveError(body.error ?? "Could not save the filter. Please try again.");
        return;
      }

      // THE PHRASE BOX IS CLEARED EXPLICITLY, not left to router.refresh().
      //
      // router.refresh() re-renders the server component and hands down fresh props, but it
      // PRESERVES CLIENT STATE — which is exactly how restoring an AI settings version left the
      // form stale while every server test passed (plans/retros/ai-a-client-and-settings.md).
      // Trusting the refresh here would leave the accepted phrase sitting in the box next to its
      // own new checkbox, reading as though it had not been saved.
      setPhrase("");
      clearProposal();

      router.refresh();
    } catch (error) {
      console.error("Could not save a retrieval filter", error);
      setSaveError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleResolve} className="flex flex-col gap-3" noValidate>
        <div>
          <h2 className="text-base font-semibold text-foreground">Teach it a filter</h2>
          <p className="mt-1 text-sm text-muted">
            Describe the talks in your own words — a speaker, a calling, a period. You will see
            what it worked out before anything is saved.
          </p>
        </div>

        <Input
          id="filter-phrase"
          label="The talks you want to reach for"
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
          placeholder="talks by President Nelson"
          maxLength={MAX_FILTER_PHRASE}
        />

        <div>
          <Button type="submit" disabled={isResolving || phrase.trim() === ""}>
            {isResolving ? "Working it out…" : "Work out a filter"}
          </Button>
        </div>

        <FormError message={resolveError} />

        {/* -----------------------------------------------------------------------------------
            A subject phrase is REFUSED, and the refusal has to teach rather than block
            ----------------------------------------------------------------------------------- */}
        {/* This is the point of the whole feature. The corpus can be filtered by who spoke and
            when; it cannot be filtered by what a talk is about, because that is what the vector
            search already does on every single call. Someone asking for "talks about the temple"
            is asking for something they are already getting — and building them a metadata filter
            from it would produce one that matches nothing while looking like it worked. */}
        {proposal?.kind === "semantic" && (
          <div className="rounded-md border border-dashed border-border bg-surface p-3">
            <p className="text-sm font-medium text-foreground">
              That is already how every search works
            </p>
            <p className="mt-1 text-sm text-muted">{proposal.explanation}</p>
          </div>
        )}

        {proposal?.kind === "unresolvable" && (
          <div className="rounded-md border border-dashed border-border bg-surface p-3">
            <p className="text-sm font-medium text-foreground">
              Nothing was saved
            </p>
            <p className="mt-1 text-sm text-muted">{proposal.explanation}</p>
          </div>
        )}

        {proposal?.kind === "filter" && (
          <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3">
            <div>
              <p className="text-sm font-medium text-foreground">This is what it would save</p>
              {/* The sentence comes from the SERVER, built by describeFilter(). It is what the
                  user is being asked to agree to, and two implementations of it would eventually
                  disagree about what was approved. */}
              <p className="mt-1 text-sm text-muted">{description}</p>
            </div>

            <Input
              id="filter-label"
              label="Name it"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={MAX_FILTER_LABEL}
            />

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void handleAccept()}
                disabled={isSaving || label.trim() === ""}
              >
                {isSaving ? "Saving…" : "Save this filter"}
              </Button>
              {/* Rejecting is a plain discard. Nothing was written, so there is nothing to undo
                  — which is what makes "re-open the panel and confirm nothing is there" a
                  meaningful check rather than a hope. */}
              <Button variant="secondary" disabled={isSaving} onClick={clearProposal}>
                Discard
              </Button>
            </div>

            <FormError message={saveError} />
          </div>
        )}
      </form>
    </Card>
  );
}
