"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import { Pill } from "@/components/ui/Pill";
import {
  ACCESS_REQUEST_STATUS_DESCRIPTIONS,
  ACCESS_REQUEST_STATUS_LABELS,
  ROLE_LABELS,
  type AccessLevel,
  type AccessRequest,
  type AccessRequestStatus,
  type Role,
} from "@/types/domain";

// ASKING, AND ANSWERING. One screen with two audiences, because they are two views of the same
// list rather than two features — and `access_requests_select` already decides which rows each
// one sees (a ward its own, a super admin every ward's).
//
// ---------------------------------------------------------------------------
// THE REQUESTER CAN SEE THE OUTCOME. THAT IS THE POINT OF THE SCREEN.
// ---------------------------------------------------------------------------
// The prototype shipped this flow WITHOUT outcome visibility and caught the gap itself. A denial
// nobody can read teaches leaders that asking does nothing — so a decided request renders its
// status, its description AND the decision note, and the note is rendered for an approval too
// rather than only for a refusal.
//
// Every wording constant is in types/domain.ts, never in a route file: this is a client component
// and importing from a module with a server dependency pulls next/headers into the browser
// bundle, which only `npm run build` catches (youth-b, youth-c).
//
// `canDecide` and `canAsk` are resolved ONCE on the server and passed down. A client component
// re-deriving a permission would be a second answer, free to disagree with the route's.

const STATUS_TONES: Record<AccessRequestStatus, "ok" | "pending" | "missing" | "neutral"> = {
  pending: "pending",
  approved_ward: "ok",
  approved_app_wide: "ok",
  denied: "missing",
};

// The shape lib/access/accessModules.ts exports, passed down rather than imported: this is a
// client component, and that module imports lib/auth/permissions, which would pull its
// dependencies into the browser bundle. Only `npm run build` catches that (youth-b, youth-c).
export type AccessModuleOption = {
  key: string;
  label: string;
  description: string;
};

export type AccessRequestsProps = {
  initialRequests: AccessRequest[];
  // The MODULES this ward may ask for, with the descriptors the prototype's role-access page uses
  // — resolved on the server from the same constant the Zod schema accepts, so the picker cannot
  // offer something the route would refuse.
  accessModules: AccessModuleOption[];
  requestableRoles: Role[];
  canAsk: boolean;
  canDecide: boolean;
};

const LEVEL_LABELS: Record<"F" | "R", string> = {
  F: "Full — they can do the work",
  R: "Read only — they can see it",
};

export function AccessRequests({
  initialRequests,
  accessModules,
  requestableRoles,
  canAsk,
  canDecide,
}: AccessRequestsProps) {
  const [requests, setRequests] = useState<AccessRequest[]>(initialRequests);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [warning, setWarning] = useState<string>();

  const [draft, setDraft] = useState({
    role: requestableRoles[0] ?? ("org_president" as Role),
    module: accessModules[0]?.key ?? "",
    level: "F" as AccessLevel,
    reason: "",
  });

  const chosenModule = accessModules.find((entry) => entry.key === draft.module);

  // What the card and the notification both say. Kept in one place here so the two cannot drift
  // from each other on screen; the server has its own copy for the notification body.
  const describe = (request: AccessRequest): string => {
    const label =
      accessModules.find((entry) => entry.key === request.module)?.label ?? request.module;
    return request.level === "R" ? `${label} (read only)` : label;
  };

  const [notes, setNotes] = useState<Record<string, string>>({});

  const pending = requests.filter((request) => request.status === "pending");
  const answered = requests.filter((request) => request.status !== "pending");

  const handleAsk = async (): Promise<void> => {
    setIsSaving(true);
    setErrorMessage(undefined);
    setWarning(undefined);

    try {
      const response = await fetch("/api/access-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: draft.role,
          module: draft.module,
          level: draft.level,
          reason: draft.reason,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        request?: AccessRequest;
        error?: string;
      };

      if (!response.ok || !payload.request) {
        throw new Error(payload.error ?? "Could not send the request.");
      }

      setRequests((current) => [payload.request as AccessRequest, ...current]);
      setDraft((current) => ({ ...current, reason: "" }));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not send the request.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDecide = async (
    request: AccessRequest,
    status: Exclude<AccessRequestStatus, "pending">,
  ): Promise<void> => {
    // The confirmation says IN WORDS what the app-wide option does, because it is the one
    // irreversible-feeling act on this screen and its blast radius is every ward in the app. It
    // is also the one that does NOT turn anything on — which is the part somebody pressing it
    // needs to know.
    if (status === "approved_app_wide") {
      const confirmed = window.confirm(
        "Approve this for EVERY ward?\n\n" +
          "Nothing turns on today. Every existing ward gets an explicit off-override and is " +
          "told about it, so each one decides for itself when to start using it.\n\n" +
          "The default itself still has to be changed in code and deployed.",
      );
      if (!confirmed) return;
    }

    setIsSaving(true);
    setErrorMessage(undefined);
    setWarning(undefined);

    try {
      const response = await fetch(`/api/access-requests/${request.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          decisionNote: notes[request.id] ?? null,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        request?: AccessRequest;
        error?: string;
        warning?: string;
      };

      if (!response.ok || !payload.request) {
        throw new Error(payload.error ?? "Could not record the decision.");
      }

      setRequests((current) =>
        current.map((entry) =>
          entry.id === request.id ? (payload.request as AccessRequest) : entry,
        ),
      );

      // A PARTIAL FAN-OUT IS SHOWN, NOT SWALLOWED. Some wards missing their off-override means
      // those wards WILL gain the permission when the default deploys, which is the one outcome
      // the whole mechanism exists to prevent.
      if (payload.warning) setWarning(payload.warning);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not record the decision.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  function renderRequest(request: AccessRequest) {
    return (
      <Card key={request.id}>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={STATUS_TONES[request.status]}>
            {ACCESS_REQUEST_STATUS_LABELS[request.status]}
          </Pill>
          <span className="text-sm font-medium text-foreground">
            {ROLE_LABELS[request.role]}
          </span>
          <span className="text-sm text-muted">{describe(request)}</span>
        </div>

        <p className="mt-2 text-sm text-foreground">{request.reason}</p>

        <p className="mt-2 text-sm text-muted">
          {ACCESS_REQUEST_STATUS_DESCRIPTIONS[request.status]}
        </p>

        {/* THE NOTE THE REQUESTER READS. Rendered whenever there is one — including on an
            approval, because a decision somebody took the trouble to explain is worth reading
            either way. */}
        {request.decisionNote && (
          <p className="mt-2 rounded-md border border-border bg-surface p-3 text-sm text-foreground">
            {request.decisionNote}
          </p>
        )}

        {canDecide && request.status === "pending" && (
          <div className="mt-3 flex flex-col gap-2">
            <Input
              id={`decision-note-${request.id}`}
              label="Note back to the ward"
              value={notes[request.id] ?? ""}
              placeholder="Required if you decline"
              onChange={(event) =>
                setNotes((current) => ({ ...current, [request.id]: event.target.value }))
              }
            />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void handleDecide(request, "approved_ward")}
                disabled={isSaving}
              >
                Approve for this ward
              </Button>
              <Button
                variant="secondary"
                onClick={() => void handleDecide(request, "approved_app_wide")}
                disabled={isSaving}
              >
                Approve for every ward
              </Button>
              <Button
                variant="secondary"
                onClick={() => void handleDecide(request, "denied")}
                disabled={isSaving}
              >
                Decline
              </Button>
            </div>
          </div>
        )}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FormError message={errorMessage} />

      {warning && (
        <Card>
          <p className="text-sm text-foreground">{warning}</p>
        </Card>
      )}

      <h2 className="text-lg font-semibold text-foreground">
        {canDecide ? "Waiting for a decision" : "Waiting for an answer"}
      </h2>

      {pending.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Nothing waiting.</p>
        </Card>
      ) : (
        pending.map(renderRequest)
      )}

      {answered.length > 0 && (
        <>
          <h2 className="mt-2 text-lg font-semibold text-foreground">Answered</h2>
          {answered.map(renderRequest)}
        </>
      )}

      {canAsk && (
        <Card>
          <h2 className="text-base font-semibold text-foreground">Ask for access</h2>
          <p className="mt-1 text-sm text-muted">
            Administration and sacrament access cannot be changed by a request.
          </p>

          <div className="mt-3 flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">Which calling</span>
              <select
                className="min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={draft.role}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, role: event.target.value as Role }))
                }
              >
                {requestableRoles.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">What they need</span>
              <select
                className="min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={draft.module}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, module: event.target.value }))
                }
              >
                {accessModules.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>

            {/* The label alone still does not say what somebody would be able to DO —
                "Sacrament — Talks" is a place, not a capability. */}
            {chosenModule && (
              <p className="-mt-1 text-sm text-muted">{chosenModule.description}</p>
            )}

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">How much</span>
              <select
                className="min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                value={draft.level}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    level: event.target.value as AccessLevel,
                  }))
                }
              >
                <option value="F">{LEVEL_LABELS.F}</option>
                <option value="R">{LEVEL_LABELS.R}</option>
              </select>
            </label>

            <Input
              id="access-request-reason"
              label="Why your ward needs it"
              value={draft.reason}
              placeholder="A sentence is enough — the person deciding reads this"
              onChange={(event) =>
                setDraft((current) => ({ ...current, reason: event.target.value }))
              }
            />

            <div>
              <Button onClick={() => void handleAsk()} disabled={isSaving}>
                {isSaving ? "Sending…" : "Send the request"}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
