// The text a leader sends with somebody's own Zoom join link (ITER-053). Pure and import-free, so
// the hand-out window can build it in the browser (roster-b: a client component must not pull in
// anything that reaches next/headers).

export type JoinLinkMessageInput = {
  displayName: string;
  wardName: string | null;
  joinUrl: string;
};

// The first word of the name they were saved under — "Ann" from "Ann Lee". A blank name never
// reaches here (the schema refuses it), but the greeting still reads naturally without one.
export function firstNameOf(displayName: string): string | null {
  const firstWord = displayName.trim().split(/\s+/)[0];
  return firstWord && firstWord.length > 0 ? firstWord : null;
}

export function buildJoinLinkMessage({ displayName, wardName, joinUrl }: JoinLinkMessageInput): string {
  const firstName = firstNameOf(displayName);
  const greeting = firstName ? `Hi ${firstName}` : "Hi";
  const meeting = wardName ? `${wardName} sacrament meeting` : "our sacrament meeting";
  return (
    `${greeting} — here is your own link to watch ${meeting} on Zoom: ${joinUrl} ` +
    "It's just for you, so please don't share it. To share with a friend, ask a member of the " +
    "bishopric for a link of their own."
  );
}
