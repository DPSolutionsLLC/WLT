"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { MEMBERS_QUERY_KEY, MemberPicker } from "@/components/roster/MemberPicker";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import type { Member } from "@/lib/roster/queries";
import { createInviteSchema } from "@/lib/validation/invite";
import type { SessionUser } from "@/types/domain";

// INVITE A PERSON ON THE WARD LIST (ITER-058 cr4). The sender picks the PERSON; the calling is the
// one the ward list gives them, worked out on the server from the same title map the Calling review
// reads. There is no role, organization or position to choose, and the server would refuse one.
//
// `candidates` is that answer for everybody who can be invited — the page computes it, so this form
// shows "Ward Clerk" the moment a person is picked rather than after a round trip. Anybody else the
// picker offers either already has a linked account or holds no calling the app recognises, and the
// form says which and will not send. The server decides again either way.
//
// ONE LIVE LINK PER PERSON (decided walking scenario 105). Choosing somebody fetches their waiting
// link, if any, from GET /api/auth/invite, so a link nobody copied in time can be copied again from
// the window. While a link is showing the button reads "Create new invite link", and making one
// cancels the old link on the server. The link is fetched, never written into the page.

export type InviteCandidate = {
  memberName: string;
  email: string | null;
  callingLabel: string;
};

export type InvitePreset = { memberId: string; memberName: string; email: string | null };

export type InviteFormProps = {
  sessionUser: SessionUser;
  candidates: Readonly<Record<string, InviteCandidate>>;
  // Why somebody the picker offers cannot be invited, as a whole sentence: already linked, or a ward
  // account with their roster email already exists. Anybody in neither map holds no calling the app
  // recognises.
  refusals: Readonly<Record<string, string>>;
  pickerNotes: Readonly<Record<string, string>>;
  // Opened from a "Callings with no linked account" row: the person is fixed and the roster email
  // is filled in, still editable.
  preset?: InvitePreset;
  framed?: boolean;
};

export function InviteForm({
  sessionUser,
  candidates,
  refusals,
  pickerNotes,
  preset,
  framed = true,
}: InviteFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [memberId, setMemberId] = useState<string | null>(preset?.memberId ?? null);
  const [email, setEmail] = useState(preset?.email ?? "");
  const [emailError, setEmailError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The link lives in component state and nowhere else — not in localStorage, not in a query
  // string. It is a bearer credential. `fresh` says whether it was made just now or read back.
  const [link, setLink] = useState<{ url: string; expiresAt: string | null; fresh: boolean } | null>(null);
  const [invitedAs, setInvitedAs] = useState<string>();
  const [copyStatus, setCopyStatus] = useState<string>();
  const [warning, setWarning] = useState<string>();
  const [waitingError, setWaitingError] = useState<string>();

  const candidate = memberId ? (candidates[memberId] ?? null) : null;
  const waitingFor = candidate ? memberId : null;

  useEffect(() => {
    if (!waitingFor) return;
    const controller = new AbortController();

    async function loadWaiting(id: string) {
      try {
        const response = await fetch(`/api/auth/invite?memberId=${encodeURIComponent(id)}`, {
          signal: controller.signal,
        });
        const body: {
          waiting?: { url: string; expiresAt: string | null } | null;
          error?: string;
        } = await response.json();

        if (!response.ok) {
          setWaitingError(body.error ?? "Could not check for a link already made.");
          return;
        }
        const waiting = body.waiting;
        if (waiting) {
          setLink((previous) =>
            previous?.url === waiting.url ? previous : { url: waiting.url, expiresAt: waiting.expiresAt, fresh: false },
          );
          setInvitedAs((previous) => previous ?? candidates[id]?.memberName);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Could not read a waiting invite", {
          error: error instanceof Error ? error.message : String(error),
        });
        setWaitingError("Could not check for a link already made. Check your connection.");
      }
    }

    void loadWaiting(waitingFor);
    return () => controller.abort();
  }, [waitingFor, candidates]);

  // The picker's trigger shows a count, not a name, so the name of somebody who cannot be invited
  // comes from the list the picker has just loaded (MemberLinkControls does the same).
  function pickedName(id: string): string {
    if (preset?.memberId === id) return preset.memberName;
    if (candidates[id]) return candidates[id].memberName;
    for (const [, members] of queryClient.getQueriesData<Member[]>({ queryKey: [MEMBERS_QUERY_KEY] })) {
      const found = members?.find((member) => member.id === id);
      if (found) return [found.firstName, found.lastName].filter(Boolean).join(" ");
    }
    return "This person";
  }

  function refusalFor(id: string): string {
    return (
      refusals[id] ??
      `${pickedName(id)} holds no calling the app recognises, so there is nothing to invite them to.`
    );
  }

  // Each person is annotated in the picker with what an invite would make them, so the bishopric
  // can see it before choosing.
  const annotations: Record<string, string> = { ...pickerNotes };
  for (const [id, entry] of Object.entries(candidates)) {
    annotations[id] = `Invite as ${entry.callingLabel}`;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    setEmailError(undefined);
    setCopyStatus(undefined);
    setWarning(undefined);

    if (!memberId) {
      setFormError("Choose the person from the ward list.");
      return;
    }
    if (!candidate) {
      setFormError(refusalFor(memberId));
      return;
    }

    const parsed = createInviteSchema.safeParse({ email, memberId });

    if (!parsed.success) {
      const flattened = parsed.error.flatten().fieldErrors;
      setEmailError(flattened.email?.[0]);
      setFormError(flattened.email ? undefined : "Check the form and try again.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      const body: {
        url?: string;
        invite?: { callingLabel: string; expiresAt: string | null };
        warning?: string | null;
        error?: string;
      } = await response.json();

      if (!response.ok || !body.url) {
        setFormError(body.error ?? "Could not create the invite. Please try again.");
        return;
      }

      setLink({ url: body.url, expiresAt: body.invite?.expiresAt ?? null, fresh: true });
      setInvitedAs(`${pickedName(memberId)}, ${body.invite?.callingLabel ?? candidate?.callingLabel ?? ""}`);
      setWarning(body.warning ?? undefined);
      router.refresh();
    } catch (error) {
      console.error("Could not create the invite", {
        error: error instanceof Error ? error.message : String(error),
      });
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyInviteUrl() {
    if (!link) return;

    try {
      await navigator.clipboard.writeText(link.url);
      setCopyStatus("Copied.");
    } catch (error) {
      console.error("Could not copy the invite link", {
        error: error instanceof Error ? error.message : String(error),
      });
      setCopyStatus("Could not copy automatically — select the link above and copy it.");
    }
  }

  const content = (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {framed && <h2 className="text-base font-semibold text-foreground">Invite someone</h2>}

        {preset ? (
          <p className="text-sm text-foreground">
            {preset.memberName}
            {candidate && <span className="text-muted"> · {candidate.callingLabel}</span>}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <MemberPicker
              user={sessionUser}
              value={memberId ? [memberId] : []}
              wholeWard
              annotations={annotations}
              disabled={isSubmitting}
              label="Who are you inviting?"
              triggerLabel={memberId ? "Choose someone else" : "Choose from the ward list"}
              onChange={(memberIds) => {
                const chosen = memberIds[0] ?? null;
                setFormError(undefined);
                setLink(null);
                setInvitedAs(undefined);
                setWarning(undefined);
                setWaitingError(undefined);
                setCopyStatus(undefined);
                setMemberId(chosen);
                if (chosen && candidates[chosen]?.email) setEmail(candidates[chosen].email ?? "");
              }}
            />
            {memberId &&
              (candidate ? (
                <p className="text-sm text-foreground">
                  {candidate.memberName} <span className="text-muted">· invited as {candidate.callingLabel}</span>
                </p>
              ) : (
                <p className="text-sm text-muted">{refusalFor(memberId)}</p>
              ))}
          </div>
        )}

        <Input
          id={preset ? `invite-email-${preset.memberId}` : "invite-email"}
          label="Email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={emailError}
          required
        />

        <FormError message={formError} />
        {waitingError && <p className="text-sm text-muted">{waitingError}</p>}
        {link && <p className="text-sm text-muted">A new link cancels the one below.</p>}

        <Button type="submit" disabled={isSubmitting || !candidate}>
          {isSubmitting ? "Creating the link…" : link ? "Create new invite link" : "Create invite link"}
        </Button>
      </form>

      {link && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-sm font-medium text-foreground">
            {link.fresh ? "Send this link to " : "Link already made for "}
            {invitedAs ?? "the person you invited"}
          </p>
          <p className="mt-2 break-all rounded-md border border-border bg-surface p-2 text-xs text-foreground">
            {link.url}
          </p>
          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
            <Button type="button" variant="secondary" onClick={() => void copyInviteUrl()}>
              Copy link
            </Button>
            {copyStatus && <span className="text-sm text-muted">{copyStatus}</span>}
          </div>
          {warning && <p className="mt-3 text-sm text-warning">{warning}</p>}
          <p className="mt-3 text-sm text-muted">{describeExpiry(link.expiresAt)}</p>
        </div>
      )}
    </>
  );

  return framed ? <Card>{content}</Card> : content;
}

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

// Counted in days rather than printed as a date, so no time zone is involved (CLAUDE.md rule 12).
function describeExpiry(expiresAt: string | null): string {
  const tail = "It works once, and you can copy it again from this person's row until it is used.";
  if (!expiresAt) return tail;
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / DAY_IN_MILLISECONDS);
  if (days <= 1) return `It expires within a day. ${tail}`;
  return `It expires in ${days} days. ${tail}`;
}
