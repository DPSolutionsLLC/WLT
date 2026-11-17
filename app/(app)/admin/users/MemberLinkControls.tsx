"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { MEMBERS_QUERY_KEY, MemberPicker } from "@/components/roster/MemberPicker";
import { Button } from "@/components/ui/Button";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";
import { FormError } from "@/components/ui/FormError";
import type { Member } from "@/lib/roster/queries";
import type { MemberLinkStatus, SessionUser } from "@/types/domain";

// LINK AN ACCOUNT TO ITS PERSON ON THE WARD LIST (ITER-058 cr1). Rendered only for somebody who may
// manage links, and never on your own row — the server refuses linking yourself anyway (P3).
//
// An unlinked or waiting account gets "Link to roster person" (a member picker in a window); a
// waiting one also gets Decline; a linked one gets Unlink.
//
// NOTHING SAVES ON ONE TAP (decided walking scenario 103): from cr2 a link decides a calling. A pick
// shows the chosen person with Link / Cancel, and Unlink takes a second tap. People already linked
// to another account are marked in the picker; the server refuses them anyway.

export type MemberLinkControlsProps = {
  sessionUser: SessionUser;
  targetUserId: string;
  targetName: string;
  linkId: string | null;
  linkStatus: MemberLinkStatus | null;
  linkedMemberNotes: Readonly<Record<string, string>>;
};

export function MemberLinkControls({
  sessionUser,
  targetUserId,
  targetName,
  linkId,
  linkStatus,
  linkedMemberNotes,
}: MemberLinkControlsProps) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [chosenMemberId, setChosenMemberId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // The picker's trigger shows a count, not a name, so the confirm reads the name from the list the
  // picker has just loaded.
  function chosenMemberName(memberId: string): string | null {
    for (const [, members] of queryClient.getQueriesData<Member[]>({ queryKey: [MEMBERS_QUERY_KEY] })) {
      const found = members?.find((candidate) => candidate.id === memberId);
      if (found) return [found.firstName, found.lastName].filter(Boolean).join(" ");
    }
    return null;
  }

  async function send(
    url: string,
    method: "POST" | "PATCH",
    body: object,
    failure: string,
  ): Promise<boolean> {
    setError(undefined);
    setIsSaving(true);
    try {
      const response = await fetch(url, {
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
      console.error("Could not change the ward list link", {
        targetUserId,
        error: caught instanceof Error ? caught.message : String(caught),
      });
      setError("Could not reach the server. Check your connection and try again.");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {linkStatus !== "active" && (
          <MemberPicker
            user={sessionUser}
            value={chosenMemberId ? [chosenMemberId] : []}
            wholeWard
            annotations={linkedMemberNotes}
            disabled={isSaving}
            label={`Which person on the ward list is ${targetName}?`}
            triggerLabel={chosenMemberId ? "Choose someone else" : "Link to roster person"}
            onChange={(memberIds) => {
              setError(undefined);
              setChosenMemberId(memberIds[0] ?? null);
            }}
          />
        )}
        {linkStatus === "pending" && linkId && (
          <Button
            variant="secondary"
            disabled={isSaving}
            onClick={() =>
              void send(
                `/api/admin/member-links/${linkId}`,
                "PATCH",
                { action: "decline" },
                "Could not decline that request. Please try again.",
              )
            }
          >
            Decline
          </Button>
        )}
        {linkStatus === "active" && linkId && (
          <ConfirmDeleteButton
            label="Unlink"
            confirmLabel="Unlink? Tap again"
            disabled={isSaving}
            onConfirm={() =>
              void send(
                `/api/admin/member-links/${linkId}`,
                "PATCH",
                { action: "end" },
                "Could not unlink that account. Please try again.",
              )
            }
          />
        )}
      </div>
      {chosenMemberId && linkStatus !== "active" && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-foreground">
            Link {targetName} to {chosenMemberName(chosenMemberId) ?? "the person you chose"}?
          </p>
          <Button
            disabled={isSaving}
            onClick={async () => {
              const linked = await send(
                "/api/admin/member-links",
                "POST",
                { userId: targetUserId, memberId: chosenMemberId },
                "Could not link that account. Please try again.",
              );
              if (linked) setChosenMemberId(null);
            }}
          >
            Link
          </Button>
          <Button variant="secondary" disabled={isSaving} onClick={() => setChosenMemberId(null)}>
            Cancel
          </Button>
        </div>
      )}
      <FormError message={error} />
    </div>
  );
}
