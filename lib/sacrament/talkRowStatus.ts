import type { TalkAskInput } from "@/lib/sacrament/talkAsks";

// THE TWO TAGS ON A TALK ROW (Topics rebuild t3, the prototype's ModuleView): where the SPEAKER
// stands and whether the TOPIC is set. Pure, so the row and its test agree by construction.
//
// Every tag is WORDS with a tone, never a colour alone (ITER-022).
//
// The speaker tag reads f1's ask inputs (lib/sacrament/sundayAsks.ts's `TalkAskInput`) and never
// re-derives an open ask, so it cannot disagree with the hub's Talks pill.
//
// ⚠️ DECLINED IS CHECKED BEFORE "NO SPEAKER", which is the prototype's order reversed on purpose.
// A decline CLEARS the speaker (lib/assignments/requestOutcome.ts), so a declined talk always has
// nobody on it — checked second, "Declined" could never appear. Choosing a new speaker resets the
// outcome (PATCH /api/assignments/[id]), so the tag moves on by itself. talksAskState() makes the
// same call for the same reason.
//
// The topic tag reads `topicTitle !== null`, the same test lib/sacrament/sundayStatus.ts counts on,
// so this page and the hub agree about what "has a topic" means.

export type TalkTagTone = "missing" | "pending" | "ok";
export type TalkTag = { label: string; tone: TalkTagTone };

export function speakerTag(ask: TalkAskInput): TalkTag {
  if (ask.requestOutcome === "declined") return { label: "Declined", tone: "missing" };
  if (!ask.hasSpeaker) return { label: "Needs speaker", tone: "missing" };
  if (ask.requestOutcome === "accepted") return { label: "Accepted", tone: "ok" };
  if (ask.openAskCount > 0) return { label: "Ask sent", tone: "pending" };
  return { label: "Speaker selected", tone: "pending" };
}

export function topicTag(topicTitle: string | null): TalkTag {
  return topicTitle === null
    ? { label: "Needs topic", tone: "missing" }
    : { label: "Topic selected", tone: "ok" };
}

// WHO WILL LET THE SPEAKER KNOW when this talk is deleted — the same rules the f2c reconcile
// applies (lib/sacrament/conductorHandover.ts), so the Delete confirm names the person who will
// actually find it on their To Do:
//   - an OPEN ask stays with whoever holds it, marked, with Told them;
//   - an ACCEPTED talk gives its last asker a "Let ___ know" to-do, or, when nobody asked through
//     To Do, the person pressing Delete;
//   - a speaker chosen but never asked was never told they would speak, so nobody is.
export type LetThemKnow = { kind: "you" } | { kind: "user"; userId: string } | null;

export function whoLetsThemKnow(input: {
  ask: TalkAskInput;
  openAskOwnerIds: readonly string[];
  latestAskOwnerId: string | null;
  currentUserId: string;
}): LetThemKnow {
  if (!input.ask.hasSpeaker) return null;

  const owner =
    input.openAskOwnerIds.length > 0
      ? input.openAskOwnerIds.includes(input.currentUserId)
        ? input.currentUserId
        : input.openAskOwnerIds[0]
      : input.ask.requestOutcome === "accepted"
        ? (input.latestAskOwnerId ?? input.currentUserId)
        : null;

  if (owner === null) return null;
  return owner === input.currentUserId ? { kind: "you" } : { kind: "user", userId: owner };
}
