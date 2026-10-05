import { emailConfiguration, getResendClient } from "@/lib/email/resend";
import {
  readEmailRecipients,
  type MusicEmailTrigger,
} from "@/lib/notifications/musicEmailPreference";

// THE MUSIC COORDINATOR'S EMAILS — ITER-038 slice mc (plan decision D1).
//
// SERVER-ONLY: it imports lib/email/resend.ts, which throws in a browser by design.
//
// Sent only to people who switched email on (lib/notifications/musicEmailPreference.ts). The To Do
// item is the thing that always happens; an email is a courtesy on top of it, so a failure here is
// REPORTED to the caller and never thrown — the to-do already exists, and refusing the finalize
// because a vendor said no would be the tail wagging the dog.
//
// NOT CONFIGURED IS NOT AN ERROR AND NOT SILENT. emailConfiguration()'s own reasons talk about the
// programme PDF, so this file says the music's version of the same fact.
//
// THE ADDRESS IS NEVER LOGGED (rule 8's spirit); a failure is logged against the user id.

export type MusicEmailRecipient = { userId: string; email: string };

export type MusicEmailResult = {
  sent: string[];
  failed: { userId: string; reason: string }[];
  notConfigured: string | null;
};

export const MUSIC_EMAIL_NOT_CONFIGURED =
  "Email isn't set up for this ward yet, so nobody was emailed.";

export async function sendMusicEmail(params: {
  to: readonly MusicEmailRecipient[];
  subject: string;
  text: string;
}): Promise<MusicEmailResult> {
  const result: MusicEmailResult = { sent: [], failed: [], notConfigured: null };
  if (params.to.length === 0) return result;

  const configuration = emailConfiguration();
  if (!configuration.configured) {
    result.notConfigured = MUSIC_EMAIL_NOT_CONFIGURED;
    return result;
  }

  const client = getResendClient();

  for (const recipient of params.to) {
    try {
      const { error } = await client.emails.send({
        from: configuration.fromAddress,
        to: [recipient.email],
        subject: params.subject,
        text: params.text,
      });

      if (error) {
        console.error(`Resend refused a music email — ${error.message}`, {
          name: error.name,
          userId: recipient.userId,
        });
        result.failed.push({ userId: recipient.userId, reason: error.message });
        continue;
      }

      result.sent.push(recipient.userId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`Could not send a music email — ${reason}`, { userId: recipient.userId });
      result.failed.push({ userId: recipient.userId, reason });
    }
  }

  return result;
}

// One sentence for the person who pressed the button, or null when there is nothing to say.
export function describeMusicEmailProblem(result: MusicEmailResult): string | null {
  if (result.notConfigured !== null) return result.notConfigured;
  if (result.failed.length === 0) return null;
  return result.failed.length === 1
    ? "One email to the music coordinator could not be sent. Their To Do item is there either way."
    : `${result.failed.length} emails to music coordinators could not be sent. Their To Do items are there either way.`;
}

function musicLink(siteUrl: string | null, sundayId: string): string | null {
  return siteUrl === null ? null : `${siteUrl}/music?sunday=${sundayId}`;
}

// A null site URL drops the link line rather than sending somebody to localhost.
export function topicsReadyEmail(params: {
  sundayLabel: string;
  topicTitles: readonly string[];
  topicsChanged: boolean;
  siteUrl: string | null;
  sundayId: string;
}): { subject: string; text: string } {
  const link = musicLink(params.siteUrl, params.sundayId);
  const topics =
    params.topicTitles.length === 0 ? "No topics are listed." : `Topics: ${params.topicTitles.join("; ")}.`;
  const opening = params.topicsChanged
    ? `The topics for ${params.sundayLabel} changed. Please check the music.`
    : `The topics for ${params.sundayLabel} are ready.`;

  return {
    subject: params.topicsChanged
      ? `Topics changed — check the music for ${params.sundayLabel}`
      : `Choose the music for ${params.sundayLabel}`,
    text: [opening, topics, link === null ? null : `Choose the music: ${link}`]
      .filter((line): line is string => line !== null)
      .join("\n\n"),
  };
}

// The note is a bishopric member's words to the coordinator — carrying it is the email's purpose.
export function sentBackEmail(params: {
  sundayLabel: string;
  note: string;
  siteUrl: string | null;
  sundayId: string;
}): { subject: string; text: string } {
  const link = musicLink(params.siteUrl, params.sundayId);
  return {
    subject: `Music sent back for ${params.sundayLabel}`,
    text: [
      `The conductor sent back the music for ${params.sundayLabel}: "${params.note}"`,
      link === null ? null : `Open the music: ${link}`,
    ]
      .filter((line): line is string => line !== null)
      .join("\n\n"),
  };
}

// Only the people who switched email on for this trigger. Never throws: the to-do already exists,
// and an email is the courtesy on top of it. A failure is returned as a sentence for the person who
// pressed the button (rule 7 — said, not swallowed).
export async function emailCoordinators(params: {
  wardId: string;
  userIds: readonly string[];
  subject: string;
  text: string;
  triggerKey: MusicEmailTrigger;
}): Promise<{ emailedCount: number; emailProblem: string | null }> {
  try {
    const recipients = await readEmailRecipients(
      params.wardId,
      params.userIds,
      params.triggerKey,
    );
    if (recipients.length === 0) return { emailedCount: 0, emailProblem: null };

    const result = await sendMusicEmail({
      to: recipients,
      subject: params.subject,
      text: params.text,
    });
    return { emailedCount: result.sent.length, emailProblem: describeMusicEmailProblem(result) };
  } catch (error) {
    console.error("Could not email the music coordinator", {
      wardId: params.wardId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      emailedCount: 0,
      emailProblem: "The music coordinator could not be emailed. Their To Do item is there either way.",
    };
  }
}
