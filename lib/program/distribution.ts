import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailConfiguration, getResendClient } from "@/lib/email/resend";
import { formatSundayLabelWithYear, type DateOnly } from "@/lib/calendar/dates";
import type { Database } from "@/types/database";

// Who gets the programme, and the send itself.
//
// ---------------------------------------------------------------------------------------------
// SIX DISTINGUISHABLE FAILURES, NOT ONE
// ---------------------------------------------------------------------------------------------
// `ai-a` established that six distinct error kinds beat one generic failure, and distribution has
// at least as many worth separating. "Could not distribute" teaches a secretary nothing: they
// cannot tell whether to add an address, wait, ring an administrator, or regenerate the PDF.

export const DISTRIBUTION_ERROR_KINDS = [
  "not_configured",
  "no_recipients",
  "too_many_recipients",
  "pdf_missing",
  "send_failed",
  "invalid_recipients",
] as const;
export type DistributionErrorKind = (typeof DISTRIBUTION_ERROR_KINDS)[number];

// Chosen so the route maps kind -> status without a second table, following lib/ai/errors.ts.
// 503 means "not set up", 422 means "the request was understood and cannot be fulfilled as sent",
// 409 means "the programme is not in a state to be distributed", 502 means "the vendor refused".
export const DISTRIBUTION_ERROR_STATUSES: Record<DistributionErrorKind, number> = {
  not_configured: 503,
  no_recipients: 422,
  too_many_recipients: 422,
  pdf_missing: 409,
  send_failed: 502,
  invalid_recipients: 422,
};

export class DistributionError extends Error {
  readonly kind: DistributionErrorKind;
  readonly status: number;

  constructor(kind: DistributionErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = "DistributionError";
    this.kind = kind;
    this.status = DISTRIBUTION_ERROR_STATUSES[kind];
    this.cause = cause;
  }
}

// isDistributionError() rather than `instanceof`, so the check survives a module-instance split —
// the same reasoning as isAiRequestError() (lib/ai/errors.ts).
export function isDistributionError(error: unknown): error is DistributionError {
  return error instanceof Error && error.name === "DistributionError";
}

// A ward distribution list is a handful of leaders plus the librarian, not the whole ward. The cap
// exists so that pasting a roster export into the settings box is REFUSED with a sentence rather
// than silently truncated or quietly burning the account's free-tier quota.
//
// No silent caps: over this, nothing is sent and the error says the number.
export const MAX_RECIPIENTS = 100;

const emailSchema = z.email();

// ---------------------------------------------------------------------------------------------
// A SECOND, NARROW READER OF wards.settings
// ---------------------------------------------------------------------------------------------
// lib/program/gather.ts reads the same blob and says it should be the only one. It reads the keys
// the DRAFT is assembled from; these two are about who receives an email, which no draft has ever
// needed and which the assembler has no reason to carry through three layers to reach here.
//
// Every field defaults and a malformed entry is DROPPED rather than throwing, exactly as
// parseProgramWardSettings does. A settings blob that cannot be parsed is an empty recipient list
// — which is refused with its own sentence below — not a route that 500s.
const distributionSettingsSchema = z.object({
  program_distribution_list: z
    .array(z.string())
    .catch([])
    .transform((entries) =>
      entries.map((entry) => entry.trim()).filter((entry) => entry !== ""),
    ),
  // The librarian prints the programmes, so they are on the list whether or not somebody
  // remembered to add them (FEATURES.md §Module 7 step 3). Stored separately because it is a role
  // the ward fills, not a line somebody typed into a list.
  librarian_email: z.string().nullable().catch(null),
});

export type ResolvedRecipients = {
  addresses: string[];
  // Entries present in settings that are not email addresses. Reported, never silently dropped:
  // an address with a typo in it belongs to exactly the person who will say they never got it.
  invalid: string[];
};

export function parseDistributionList(settings: unknown): ResolvedRecipients {
  const source =
    settings === null || typeof settings !== "object" || Array.isArray(settings)
      ? {}
      : (settings as Record<string, unknown>);

  const parsed = distributionSettingsSchema.parse({
    program_distribution_list: source.program_distribution_list ?? [],
    librarian_email: source.librarian_email ?? null,
  });

  const librarian = parsed.librarian_email?.trim() ?? "";
  const candidates = [
    ...parsed.program_distribution_list,
    ...(librarian === "" ? [] : [librarian]),
  ];

  const addresses: string[] = [];
  const invalid: string[] = [];
  // Case-insensitively deduped, so a librarian who is also on the list is emailed once rather than
  // twice. Addresses keep the casing they were typed in; only the comparison is lowered.
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (!emailSchema.safeParse(candidate).success) {
      invalid.push(candidate);
      continue;
    }

    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    addresses.push(candidate);
  }

  return { addresses, invalid };
}

export async function readDistributionRecipients(
  wardId: string,
  client: SupabaseClient<Database>,
): Promise<ResolvedRecipients> {
  const { data, error } = await client
    .from("wards")
    .select("settings")
    .eq("id", wardId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a ward's distribution list — ${error.message}`, { wardId });
    throw new Error(`Could not read the ward's distribution list: ${error.message}`);
  }

  return parseDistributionList(data?.settings ?? null);
}

export type DistributionFailure = { address: string; reason: string };

export type DistributionOutcome = {
  sentCount: number;
  failedCount: number;
  // One entry per failure, each naming the reason. This is what a secretary reads on screen, and
  // it is deliberately NOT what reaches the audit log — see the distribute route.
  failures: DistributionFailure[];
};

export type SendProgramParams = {
  recipients: readonly string[];
  wardName: string;
  sundayDate: DateOnly;
  pdf: Buffer;
  publicUrl: string | null;
};

function attachmentFilename(sundayDate: DateOnly): string {
  return `sacrament-programme-${sundayDate}.pdf`;
}

function bodyText(
  wardName: string,
  sundayDate: DateOnly,
  publicUrl: string | null,
): string {
  const label = formatSundayLabelWithYear(sundayDate);
  const link = publicUrl === null ? "" : `\n\nYou can also read it online: ${publicUrl}`;

  return `The sacrament meeting programme for ${label} is attached.\n\n${wardName}${link}`;
}

// ---------------------------------------------------------------------------------------------
// ONE SEND PER RECIPIENT, NOT ONE SEND WITH EVERY ADDRESS IN THE `to` FIELD
// ---------------------------------------------------------------------------------------------
// Two reasons, and both matter.
//
//   1. PRIVACY. A single send addressed to forty people shows all forty addresses to all forty. A
//      ward's leadership email addresses are not a mailing list anybody consented to publish.
//
//   2. PARTIAL FAILURE IS A REAL STATE. Resend can accept some recipients and reject others. One
//      send with many `to` addresses returns one result, so a rejection of three of them is
//      invisible. One send per recipient is what makes sentCount and failedCount honest.
//
// resend.batch.send() would be a single call, but it does not carry attachments — and the
// attachment is the entire point of this feature.
export async function sendProgramEmails({
  recipients,
  wardName,
  sundayDate,
  pdf,
  publicUrl,
}: SendProgramParams): Promise<DistributionOutcome> {
  const configuration = emailConfiguration();

  // Checked here as well as in the route. The route refuses early so the UI never offers the
  // button; this is the guard that keeps the module safe to call from anywhere else later.
  if (!configuration.configured) {
    throw new DistributionError("not_configured", configuration.reason);
  }

  if (recipients.length === 0) {
    throw new DistributionError(
      "no_recipients",
      "Nobody is on the programme distribution list yet. Add at least one email address in ward settings before sending.",
    );
  }

  if (recipients.length > MAX_RECIPIENTS) {
    throw new DistributionError(
      "too_many_recipients",
      `The distribution list has ${recipients.length} addresses, over the limit of ${MAX_RECIPIENTS}. Nothing was sent — shorten the list in ward settings.`,
    );
  }

  const client = getResendClient();
  const subject = `Sacrament meeting programme — ${formatSundayLabelWithYear(sundayDate)}`;
  const text = bodyText(wardName, sundayDate, publicUrl);
  const attachment = {
    filename: attachmentFilename(sundayDate),
    content: pdf.toString("base64"),
  };

  const failures: DistributionFailure[] = [];
  let sentCount = 0;

  for (const address of recipients) {
    try {
      const { error } = await client.emails.send({
        from: configuration.fromAddress,
        to: [address],
        subject,
        text,
        attachments: [attachment],
      });

      if (error) {
        // THE VENDOR'S OWN RESPONSE IS LOGGED. The `deployment` retro recorded Resend refusing an
        // unverified sender and that cause surviving only in Resend's dashboard, reaching the app
        // as a bare 500. Never let the reason exist only over there.
        console.error(`Resend refused a programme email — ${error.message}`, {
          name: error.name,
          sundayDate,
        });
        failures.push({ address, reason: error.message });
        continue;
      }

      sentCount += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`Could not send a programme email — ${reason}`, { sundayDate });
      failures.push({ address, reason });
    }
  }

  // TOTAL FAILURE IS AN ERROR, PARTIAL FAILURE IS A RESULT.
  //
  // The distinction is what stops the route marking a programme `distributed` when nothing left
  // the building — there is no path out of `distributed`, so a wrong one is permanent.
  if (sentCount === 0) {
    throw new DistributionError(
      "send_failed",
      `The programme could not be sent to anybody on the list. ${failures[0]?.reason ?? "The email service refused every message."}`,
      failures,
    );
  }

  return { sentCount, failedCount: failures.length, failures };
}
