"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { Input } from "@/components/ui/Input";
import type { PublicRegistrationQuestion } from "@/lib/zoom/publicRegistration";
import { checkAnswers, questionsFor } from "@/lib/zoom/registrationAnswers";

// THE PUBLIC ZOOM SIGN-UP FORM (ITER-052). Opened from a QR code or a shared link on a phone, by
// somebody with no account. It shows the ward's name and the ward's own questions and nothing else
// from the ward (CLAUDE.md §9: every field on a public page is a privacy decision).
//
// The member question comes first because it decides which of the ward's questions are asked. A
// follow-up (the address after "Yes" to the missionaries) appears under its question only once that
// question is answered Yes. The server re-checks every answer against the ward's live questions with
// the same rule; the check here only saves a round trip.

type YesNo = boolean | null;

export type RegistrationFormProps = {
  slug: string;
  wardName: string;
  questions: PublicRegistrationQuestion[];
};

async function readError(response: Response): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    return "Something went wrong sending your request. Please try again.";
  }
  return "Something went wrong sending your request. Please try again.";
}

function YesNoButtons({
  value,
  onChange,
  disabled,
  labelledBy,
}: {
  value: YesNo;
  onChange: (value: boolean) => void;
  disabled: boolean;
  labelledBy: string;
}) {
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex gap-2">
      {[true, false].map((option) => (
        <Button
          key={String(option)}
          className="flex-1 basis-0"
          variant={value === option ? "primary" : "secondary"}
          aria-pressed={value === option}
          disabled={disabled}
          onClick={() => onChange(option)}
        >
          {option ? "Yes" : "No"}
        </Button>
      ))}
    </div>
  );
}

export function RegistrationForm({ slug, wardName, questions }: RegistrationFormProps) {
  const searchParams = useSearchParams();
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [saysMember, setSaysMember] = useState<YesNo>(null);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [thanks, setThanks] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const asked =
    saysMember === null ? [] : questionsFor(questions, saysMember, (id) => answers[id] === true);

  function setAnswer(questionId: string, answer: string | boolean) {
    setAnswers((current) => ({ ...current, [questionId]: answer }));
  }

  async function submit() {
    setError(undefined);

    if (displayName.trim() === "") return setError("Enter your name.");
    if (phone.trim() === "") return setError("Enter a phone number we can reach you on.");
    if (saysMember === null) return setError("Tell us whether you're a member of the ward.");

    const submitted = asked
      .filter((question) => answers[question.id] !== undefined)
      .map((question) => ({ questionId: question.id, answer: answers[question.id] }));
    const checked = checkAnswers(questions, saysMember, submitted);
    if (!checked.ok) return setError(checked.error);

    setIsSending(true);
    try {
      const response = await fetch("/api/public/zoom-registrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          displayName,
          phone,
          email,
          saysMember,
          answers: submitted,
          ref: searchParams.get("ref"),
          website,
        }),
      });

      if (!response.ok) {
        setError(await readError(response));
        return;
      }

      const parsed = (await response.json()) as { statusUrl: string | null; message: string };
      if (parsed.statusUrl) {
        window.location.assign(parsed.statusUrl);
        return;
      }
      setThanks(parsed.message);
    } catch (caught) {
      console.error("Could not send a Zoom sign-up", caught);
      setError("Your request couldn't be sent. Check your connection and try again.");
    } finally {
      setIsSending(false);
    }
  }

  if (thanks) {
    return (
      <main className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold text-foreground">Thank you</h1>
        <p role="status" className="text-sm text-foreground">
          {thanks}
        </p>
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-foreground">Watch {wardName} sacrament meeting</h1>
        <p className="text-sm text-muted">
          The bishopric uses this to send you a personal link to the stream. We don&apos;t share it.
        </p>
      </div>

      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!isSending) void submit();
        }}
      >
        <Input
          id="zoom-signup-name"
          label="Your name"
          autoComplete="name"
          value={displayName}
          maxLength={120}
          onChange={(event) => setDisplayName(event.target.value)}
          disabled={isSending}
          required
        />
        <Input
          id="zoom-signup-phone"
          label="Phone number"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          maxLength={40}
          onChange={(event) => setPhone(event.target.value)}
          disabled={isSending}
          required
        />
        <Input
          id="zoom-signup-email"
          label="Email (optional)"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          maxLength={254}
          onChange={(event) => setEmail(event.target.value)}
          disabled={isSending}
        />

        <div className="flex flex-col gap-2">
          <p id="zoom-signup-member" className="text-sm font-medium text-foreground">
            Are you a member of {wardName}?
          </p>
          <YesNoButtons
            value={saysMember}
            onChange={setSaysMember}
            disabled={isSending}
            labelledBy="zoom-signup-member"
          />
        </div>

        {asked.map((question) => {
          const labelId = `zoom-signup-question-${question.id}`;
          const label = question.isRequired ? question.prompt : `${question.prompt} (optional)`;
          const followUpClass = question.shownWhenYesTo ? "border-l-2 border-border pl-3" : "";
          if (question.kind === "yes_no") {
            const value = answers[question.id];
            return (
              <div key={question.id} className={`flex flex-col gap-2 ${followUpClass}`}>
                <p id={labelId} className="text-sm font-medium text-foreground">
                  {label}
                </p>
                <YesNoButtons
                  value={typeof value === "boolean" ? value : null}
                  onChange={(answer) => setAnswer(question.id, answer)}
                  disabled={isSending}
                  labelledBy={labelId}
                />
              </div>
            );
          }
          const value = answers[question.id];
          return (
            <div key={question.id} className={followUpClass}>
              <Input
                id={labelId}
                label={label}
                value={typeof value === "string" ? value : ""}
                maxLength={500}
                onChange={(event) => setAnswer(question.id, event.target.value)}
                disabled={isSending}
              />
            </div>
          );
        })}

        {/* The honeypot. Off-screen and hidden from assistive technology; a person never fills it. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label htmlFor="zoom-signup-website">Leave this empty</label>
          <input
            id="zoom-signup-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </div>

        <FormError message={error} />

        <Button type="submit" disabled={isSending}>
          {isSending ? "Sending…" : "Ask for a link"}
        </Button>
      </form>
    </main>
  );
}
