"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { VISIT_PROGRESS_QUERY_KEY } from "@/app/(app)/visits/progressQueryKey";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { normalizePhone } from "@/lib/assignments/smsLink";
import { MAX_SHARED_NOTES } from "@/lib/validation/visit";
import {
  VISIT_ATTEMPT_DETAILS,
  VISIT_ATTEMPT_DETAIL_LABELS,
  type VisitAttemptDetail,
} from "@/types/domain";

// The contact window for one household (ITER-055 bv3, prototype contact panel): each member's
// phone as a link that dials, a way to log a call that did not reach anybody, and a way on to
// scheduling an appointment.
//
// A LOGGED CALL IS ALWAYS AN ATTEMPT. A call is never a done visit (decided with the user
// 2026-11-04; migration 101 holds it), so this window has no "it went well" answer — a call that
// reached the family and set up a visit goes on to Schedule an appointment.

export type HouseholdContact = {
  memberId: string;
  name: string;
  phone: string | null;
};

export type ContactPanelProps = {
  householdId: string;
  familyName: string;
  contacts: HouseholdContact[];
  // Absent when the reader cannot log for this organization, so the section is absent.
  canLog: boolean;
  today: string;
  onSchedule?: () => void;
};

const SELECT_CLASSES =
  "min-h-11 rounded-md border border-border bg-surface-raised px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

const SHARED_TEXTAREA_CLASSES =
  "min-h-20 rounded-md border border-warning bg-surface-raised px-3 py-2 text-base text-warning placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("The server sent a response this page could not read.");
  }
}

export function contactsWithPhones(
  contacts: readonly HouseholdContact[],
): { memberId: string; name: string; display: string; href: string }[] {
  return contacts.flatMap((contact) => {
    if (contact.phone === null) return [];
    const dialable = normalizePhone(contact.phone);
    if (dialable === null) return [];
    return [
      { memberId: contact.memberId, name: contact.name, display: contact.phone, href: `tel:${dialable}` },
    ];
  });
}

export function ContactPanel({
  householdId,
  familyName,
  contacts,
  canLog,
  today,
  onSchedule,
}: ContactPanelProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [detail, setDetail] = useState<VisitAttemptDetail | "">("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const phones = contactsWithPhones(contacts);

  async function logAttempt(): Promise<void> {
    setError(undefined);
    setNotice(undefined);

    if (detail === "") {
      setError("Choose how the call went.");
      return;
    }

    setSaving(true);

    try {
      // No `participants` key, so the route records the caller as the one who tried — the person
      // logging a call is the person who made it.
      const response = await fetch("/api/visits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          householdId,
          visitDate: today,
          visitType: "phone",
          outcome: "attempted",
          attemptDetail: detail,
          arrangement: "drop_in",
          sharedNotes: notes.trim() === "" ? null : notes,
        }),
      });

      const payload = await readJson(response);

      if (!response.ok) {
        setError(
          typeof payload.error === "string" ? payload.error : "Could not record that call.",
        );
        return;
      }

      setDetail("");
      setNotes("");
      setNotice("Call recorded as an attempt.");
      router.refresh();
      await queryClient.invalidateQueries({ queryKey: [VISIT_PROGRESS_QUERY_KEY] });
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">Phone numbers</h3>
        {phones.length === 0 ? (
          <p className="text-sm text-muted">No phone number on file for the {familyName} household.</p>
        ) : (
          <ul className="flex flex-col">
            {phones.map((phone) => (
              <li key={phone.memberId}>
                <a
                  href={phone.href}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-md px-1 text-sm text-foreground hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span>{phone.name}</span>
                  <span className="font-medium text-primary">{phone.display}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canLog ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">Log a contact attempt</h3>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="contact-attempt-detail" className="text-sm font-medium text-foreground">
              How the call went
            </label>
            <select
              id="contact-attempt-detail"
              className={SELECT_CLASSES}
              value={detail}
              onChange={(event) => setDetail(event.target.value as VisitAttemptDetail | "")}
            >
              <option value="">Choose…</option>
              {VISIT_ATTEMPT_DETAILS.map((option) => (
                <option key={option} value={option}>
                  {VISIT_ATTEMPT_DETAIL_LABELS[option]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="contact-attempt-notes" className="text-sm font-medium text-warning">
              Shared notes
            </label>
            <p id="contact-attempt-notes-help" className="text-sm text-warning">
              Anyone who reviews this household&rsquo;s visits will read these.
            </p>
            <textarea
              id="contact-attempt-notes"
              aria-describedby="contact-attempt-notes-help"
              className={SHARED_TEXTAREA_CLASSES}
              maxLength={MAX_SHARED_NOTES}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          <FormError message={error} />
          {notice ? (
            <p role="status" className="text-sm text-success">
              {notice}
            </p>
          ) : null}

          <div>
            <Button onClick={() => void logAttempt()} disabled={saving}>
              {saving ? "Saving…" : "Record the call"}
            </Button>
          </div>
        </section>
      ) : null}

      {onSchedule === undefined ? null : (
        <div className="border-t border-border pt-3">
          <Button variant="secondary" onClick={onSchedule}>
            Schedule an appointment
          </Button>
        </div>
      )}
    </div>
  );
}
