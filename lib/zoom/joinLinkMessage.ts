// The words a leader sends with somebody's own Zoom join link (ITER-053). Pure and import-free, so
// the hand-out window can build them in the browser (roster-b: a client component must not pull in
// anything that reaches next/headers).
//
// A TEXT CANNOT HIDE A LINK, an email can (plans/zoom-link-email-and-text.md). So a text sends the
// greeting and the link as two messages — a message holding only a link shows as a preview card on
// most phones — and the email puts the link behind a button.

export type JoinLinkMessageInput = {
  displayName: string;
  wardName: string | null;
  joinUrl: string;
};

type GreetingInput = Omit<JoinLinkMessageInput, "joinUrl">;

export type JoinLinkEmail = { subject: string; html: string; text: string };

const EMAIL_BUTTON_LABEL = "Watch sacrament meeting";

const NO_REPLY_SENTENCE =
  "Replies to this email aren't read. Text a member of the bishopric with any questions.";

// The first word of the name they were saved under — "Ann" from "Ann Lee". A blank name never
// reaches here (the schema refuses it), but the greeting still reads naturally without one.
export function firstNameOf(displayName: string): string | null {
  const firstWord = displayName.trim().split(/\s+/)[0];
  return firstWord && firstWord.length > 0 ? firstWord : null;
}

function meetingName(wardName: string | null): string {
  return wardName ? `${wardName} sacrament meeting` : "our sacrament meeting";
}

function greetingLine(displayName: string): string {
  const firstName = firstNameOf(displayName);
  return firstName ? `Hi ${firstName}` : "Hi";
}

const KEEP_IT_PRIVATE =
  "It's just for you, so please don't share it. To share with a friend, ask a member of the " +
  "bishopric for a link of their own.";

// The first of the two texts. It never holds the link, so the second text can be the link alone.
export function buildJoinLinkGreeting({ displayName, wardName }: GreetingInput): string {
  return (
    `${greetingLine(displayName)} — here is your own link to watch ${meetingName(wardName)} ` +
    `on Zoom. ${KEEP_IT_PRIVATE}`
  );
}

// Greeting and link in one message, for Copy. The link goes last, on its own line.
export function buildJoinLinkMessage(input: JoinLinkMessageInput): string {
  return `${buildJoinLinkGreeting(input)}\n\n${input.joinUrl}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// The emailed version. The HTML hides the link behind a button; the plain-text copy carries it in
// full, because some mail apps show only the plain text.
export function buildJoinLinkEmail({ displayName, wardName, joinUrl }: JoinLinkMessageInput): JoinLinkEmail {
  const meeting = meetingName(wardName);
  const subject = `Your link to watch ${meeting} on Zoom`;
  const opening = `${greetingLine(displayName)} — here is your own link to watch ${meeting} on Zoom.`;

  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1f2937">',
    `<p>${escapeHtml(opening)}</p>`,
    '<p style="margin:24px 0">',
    `<a href="${escapeHtml(joinUrl)}" style="display:inline-block;padding:12px 20px;border-radius:8px;` +
      `background:#1d4ed8;color:#ffffff;font-weight:bold;text-decoration:none">${EMAIL_BUTTON_LABEL}</a>`,
    "</p>",
    `<p>${escapeHtml(KEEP_IT_PRIVATE)}</p>`,
    `<p style="font-size:13px;color:#6b7280">${escapeHtml(NO_REPLY_SENTENCE)}</p>`,
    "</div>",
  ].join("");

  const text = `${opening}\n\n${EMAIL_BUTTON_LABEL}: ${joinUrl}\n\n${KEEP_IT_PRIVATE}\n\n${NO_REPLY_SENTENCE}`;

  return { subject, html, text };
}
