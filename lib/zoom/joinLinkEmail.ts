import { emailConfiguration, getResendClient } from "@/lib/email/resend";
import type { JoinLinkEmail } from "@/lib/zoom/joinLinkMessage";

// EMAILING SOMEBODY THEIR OWN ZOOM LINK (plans/zoom-link-email-and-text.md, P3–P6).
//
// SERVER-ONLY: it imports lib/email/resend.ts, which throws in a browser by design.
//
// A vendor refusal is RETURNED, never thrown, so the route can answer with a sentence. Neither the
// address nor the link is ever logged; a failure is logged against the invitee id.

export type JoinLinkEmailResult =
  | { status: "sent" }
  | { status: "not_configured" }
  | { status: "failed"; reason: string };

export const JOIN_LINK_EMAIL_NOT_CONFIGURED =
  "Email isn't set up for this ward yet, so nothing was sent. Use Text it instead.";

export async function sendJoinLinkEmail(params: {
  inviteeId: string;
  to: string;
  email: JoinLinkEmail;
}): Promise<JoinLinkEmailResult> {
  const configuration = emailConfiguration();
  if (!configuration.configured) return { status: "not_configured" };

  try {
    const { error } = await getResendClient().emails.send({
      from: configuration.fromAddress,
      to: [params.to],
      subject: params.email.subject,
      html: params.email.html,
      text: params.email.text,
    });

    if (error) {
      console.error(`Resend refused a Zoom link email — ${error.message}`, {
        name: error.name,
        inviteeId: params.inviteeId,
      });
      return { status: "failed", reason: error.message };
    }

    return { status: "sent" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Could not send a Zoom link email — ${reason}`, { inviteeId: params.inviteeId });
    return { status: "failed", reason };
  }
}
