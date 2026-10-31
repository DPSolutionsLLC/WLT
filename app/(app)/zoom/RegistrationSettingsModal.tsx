"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Modal } from "@/components/ui/Modal";
import { urlQrDataUri } from "@/lib/zoom/joinLinkQr";
import type { RegistrationSettings } from "@/lib/zoom/registrationSettings";

// THE SIGN-UP SETTINGS WINDOW (ITER-052) — the bishopric's three switches, the public link and its
// QR code for printing. Each switch saves the moment it changes. The QR is drawn in the browser
// (lib/zoom/joinLinkQr.ts) and downloads as a PNG; it is not added to the app's programme PDF
// (plan P11).

type SettingKey = "isOpen" | "autoApprove" | "emailBishopricOnNew";

export type RegistrationSettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  settings: RegistrationSettings;
  registrationUrl: string | null;
  // True while the site still answers on its temporary vercel.app address (ITER-039 moves it).
  siteIsTemporary: boolean;
};

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : fallback;
  } catch {
    return "The server sent a response this page could not read.";
  }
}

function SettingSwitch({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex min-h-11 items-start gap-3">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-5 shrink-0"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

export function RegistrationSettingsModal({
  isOpen,
  onClose,
  onSaved,
  settings,
  registrationUrl,
  siteIsTemporary,
}: RegistrationSettingsModalProps) {
  const [values, setValues] = useState({
    isOpen: settings.isOpen,
    autoApprove: settings.autoApprove,
    emailBishopricOnNew: settings.emailBishopricOnNew,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);
  const [qrDataUri, setQrDataUri] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | undefined>();

  useEffect(() => {
    if (!isOpen || !registrationUrl || qrDataUri) return;
    let cancelled = false;
    urlQrDataUri(registrationUrl)
      .then((uri) => {
        if (!cancelled) setQrDataUri(uri);
      })
      .catch((caught: unknown) => {
        console.error("Could not draw the sign-up page's QR code", caught);
        if (!cancelled) setQrError("Could not draw the QR code. Copy the link instead.");
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, registrationUrl, qrDataUri]);

  async function save(key: SettingKey, value: boolean) {
    const previous = values;
    setValues({ ...values, [key]: value });
    setIsSaving(true);
    setError(undefined);
    try {
      const response = await fetch("/api/zoom/registration-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!response.ok) {
        throw new Error(await readError(response, "Could not save the setting. Please try again."));
      }
      onSaved();
    } catch (caught) {
      setValues(previous);
      setError(caught instanceof Error ? caught.message : "Could not save the setting.");
    } finally {
      setIsSaving(false);
    }
  }

  async function copyLink() {
    if (!registrationUrl) return;
    setCopied(false);
    try {
      await navigator.clipboard.writeText(registrationUrl);
      setCopied(true);
    } catch (caught) {
      console.error("Could not copy the sign-up link", caught);
      setError("This device wouldn't copy the link. Select it and copy it by hand.");
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Sign-up settings">
      <div className="flex flex-col gap-4">
        <SettingSwitch
          id="zoom-signup-open"
          label="Sign-up page open"
          hint="When it's off, the page tells people sign-ups are closed."
          checked={values.isOpen}
          disabled={isSaving}
          onChange={(checked) => void save("isOpen", checked)}
        />
        <SettingSwitch
          id="zoom-signup-auto"
          label="Approve automatically"
          hint="Off: every serving member of the bishopric approves each request first."
          checked={values.autoApprove}
          disabled={isSaving}
          onChange={(checked) => void save("autoApprove", checked)}
        />
        <SettingSwitch
          id="zoom-signup-email"
          label="Email the bishopric about each new sign-up"
          hint={
            values.autoApprove
              ? undefined
              : "While approvals are on, the bishopric is always emailed about a new request."
          }
          checked={values.autoApprove ? values.emailBishopricOnNew : true}
          disabled={isSaving || !values.autoApprove}
          onChange={(checked) => void save("emailBishopricOnNew", checked)}
        />

        <FormError message={error} />

        <section className="flex flex-col gap-2 border-t border-border pt-4" aria-labelledby="zoom-signup-link">
          <h3 id="zoom-signup-link" className="text-sm font-semibold text-foreground">
            The sign-up link
          </h3>
          {registrationUrl ? (
            <>
              <p className="break-all text-sm text-foreground">{registrationUrl}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void copyLink()}>
                  {copied ? "Link copied" : "Copy link"}
                </Button>
                {qrDataUri ? (
                  <a
                    href={qrDataUri}
                    download="zoom-sign-up-qr.png"
                    className={
                      "inline-flex min-h-11 items-center justify-center rounded-md border border-border " +
                      "bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-raised " +
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    }
                  >
                    Download QR
                  </a>
                ) : null}
              </div>
              {qrDataUri ? (
                // A data URI drawn in the browser; next/image adds nothing for it.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUri}
                  alt="QR code for the stream sign-up page"
                  width={200}
                  height={200}
                  className="h-auto w-full max-w-[200px] self-center rounded-md bg-white"
                />
              ) : null}
              <FormError message={qrError} />
              <p className="text-xs text-muted">
                Print the QR code on the programme or a card, so people can scan it to ask for a link.
              </p>
              {siteIsTemporary ? (
                <p className="text-xs text-warning">
                  The site is still on its temporary address. Print the QR code after it moves to the
                  ward&apos;s own address, or the printed code will stop working.
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted">
              The site&apos;s web address isn&apos;t set up yet, so the link and QR code can&apos;t be
              shown here.
            </p>
          )}
        </section>

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
