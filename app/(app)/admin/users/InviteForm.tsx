"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import type { WardOrganization } from "@/lib/auth/adminUsers";
import { createInviteSchema } from "@/lib/validation/invite";
import { INVITABLE_ROLES, ROLE_LABELS, type Role } from "@/types/domain";

export type InviteFormProps = {
  organizations: WardOrganization[];
};

const SELECT_CLASSES =
  "min-h-11 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

export function InviteForm({ organizations }: InviteFormProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("ward_council_member");
  const [orgId, setOrgId] = useState("");
  const [counselorPosition, setCounselorPosition] = useState("");
  const [emailError, setEmailError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The generated link lives here and nowhere else — not in localStorage, not in a query
  // string. It is a bearer credential, and closing the page is meant to be the end of it.
  const [inviteUrl, setInviteUrl] = useState<string>();
  const [copyStatus, setCopyStatus] = useState<string>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    setEmailError(undefined);
    setInviteUrl(undefined);
    setCopyStatus(undefined);

    const parsed = createInviteSchema.safeParse({
      email,
      role,
      orgId: orgId === "" ? null : orgId,
      counselorPosition:
        counselorPosition === "" ? null : (Number(counselorPosition) as 1 | 2),
    });

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

      const body: { url?: string; error?: string } = await response.json();

      if (!response.ok || !body.url) {
        setFormError(body.error ?? "Could not create the invite. Please try again.");
        return;
      }

      setInviteUrl(body.url);
      setEmail("");
    } catch (error) {
      console.error("Could not create the invite", error);
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyInviteUrl() {
    if (!inviteUrl) return;

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyStatus("Copied.");
    } catch (error) {
      console.error("Could not copy the invite link", error);
      setCopyStatus("Could not copy automatically — select the link above and copy it.");
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <h2 className="text-base font-semibold text-foreground">Invite someone</h2>

        <Input
          id="invite-email"
          label="Email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={emailError}
          required
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-role" className="text-sm font-medium text-foreground">
            Role
          </label>
          <select
            id="invite-role"
            className={SELECT_CLASSES}
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
          >
            {INVITABLE_ROLES.map((option) => (
              <option key={option} value={option}>
                {ROLE_LABELS[option]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="invite-organization"
            className="text-sm font-medium text-foreground"
          >
            Organization
          </label>
          <select
            id="invite-organization"
            className={SELECT_CLASSES}
            value={orgId}
            onChange={(event) => setOrgId(event.target.value)}
          >
            <option value="">No organization</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </div>

        {role === "counselor" && (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="invite-counselor-position"
              className="text-sm font-medium text-foreground"
            >
              Counselor position
            </label>
            <select
              id="invite-counselor-position"
              className={SELECT_CLASSES}
              value={counselorPosition}
              onChange={(event) => setCounselorPosition(event.target.value)}
            >
              <option value="">Not set</option>
              <option value="1">First counselor</option>
              <option value="2">Second counselor</option>
            </select>
          </div>
        )}

        <FormError message={formError} />

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating the link…" : "Create invite link"}
        </Button>
      </form>

      {inviteUrl && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-sm font-medium text-foreground">
            Send this link to the person you invited
          </p>
          <p className="mt-2 break-all rounded-md border border-border bg-surface p-2 text-xs text-foreground">
            {inviteUrl}
          </p>
          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
            <Button type="button" variant="secondary" onClick={() => void copyInviteUrl()}>
              Copy link
            </Button>
            {copyStatus && <span className="text-sm text-muted">{copyStatus}</span>}
          </div>
          <p className="mt-3 text-sm text-muted">
            It expires in 7 days and works once. It is shown here only until you leave this
            page — copy it now.
          </p>
        </div>
      )}
    </Card>
  );
}
