import { describe, expect, it } from "vitest";
import { approvalLine, type BishopricPerson, waitingOnNames } from "@/lib/zoom/registrationRow";
import type { RegistrationResponse, ZoomRegistration } from "@/lib/zoom/registrations";

// "Approved by … · Wants to talk first: … · Waiting on: …" (ITER-052 z3b). Computed on read against
// whoever serves in the bishopric NOW, so a released calling drops out without a write — and the
// rule for "Finish approval" must match respond_to_zoom_registration() exactly.

const BISHOP: BishopricPerson = { userId: "bishop", name: "Dan Peterson" };
const FIRST: BishopricPerson = { userId: "first", name: "Tom Haskell" };
const SECOND: BishopricPerson = { userId: "second", name: "Ray Ortiz" };
const SERVING = [BISHOP, FIRST, SECOND];

function pending(responses: RegistrationResponse[]): Pick<ZoomRegistration, "status" | "responses"> {
  return { status: "pending", responses };
}

function said(person: BishopricPerson, response: RegistrationResponse["response"]): RegistrationResponse {
  return { userId: person.userId, name: person.name, response };
}

describe("waitingOnNames", () => {
  it("waits on everybody, the reader as 'you', when nobody has answered", () => {
    const state = waitingOnNames(pending([]), SERVING, "first");
    expect(state).toEqual({
      approvedBy: [],
      talkFirst: [],
      waitingOn: ["Dan Peterson", "you", "Ray Ortiz"],
      canFinish: false,
      finishReason: null,
      ownResponse: null,
    });
    expect(approvalLine(state)).toBe("Waiting on: Dan Peterson, you, Ray Ortiz");
  });

  it("separates approvals, talk-first and silence", () => {
    const state = waitingOnNames(
      pending([said(BISHOP, "approve"), said(FIRST, "talk_first")]),
      SERVING,
      "second",
    );
    expect(approvalLine(state)).toBe(
      "Approved by Dan Peterson · Wants to talk first: Tom Haskell · Waiting on: you",
    );
    expect(state.canFinish).toBe(false);
    expect(state.ownResponse).toBeNull();
  });

  it("reports the reader's own answer so the button reads pressed", () => {
    const state = waitingOnNames(pending([said(FIRST, "talk_first")]), SERVING, "first");
    expect(state.ownResponse).toBe("talk_first");
    expect(state.talkFirst).toEqual(["you"]);
  });

  it("offers Finish once a released member was the only one left", () => {
    const responses = [said(BISHOP, "approve"), said(SECOND, "approve")];
    expect(waitingOnNames(pending(responses), SERVING, "bishop").canFinish).toBe(false);

    const afterRelease = waitingOnNames(pending(responses), [BISHOP, SECOND], "bishop");
    expect(afterRelease.canFinish).toBe(true);
    expect(afterRelease.waitingOn).toEqual([]);
    expect(afterRelease.finishReason).toBe(
      "The bishopric has changed since this came in. Everyone serving now has approved.",
    );
  });

  it("names a released member who wanted to talk first when explaining Finish", () => {
    const responses = [said(BISHOP, "approve"), said(SECOND, "approve"), said(FIRST, "talk_first")];
    expect(waitingOnNames(pending(responses), SERVING, "bishop").finishReason).toBeNull();

    const afterRelease = waitingOnNames(pending(responses), [BISHOP, SECOND], "bishop");
    expect(afterRelease.canFinish).toBe(true);
    expect(afterRelease.finishReason).toBe(
      "Tom Haskell wanted to talk first and is no longer in the bishopric. Everyone serving now has approved.",
    );
  });

  it("names two released members with 'and'", () => {
    const responses = [said(BISHOP, "approve"), said(FIRST, "talk_first"), said(SECOND, "talk_first")];
    expect(waitingOnNames(pending(responses), [BISHOP], "bishop").finishReason).toBe(
      "Tom Haskell and Ray Ortiz wanted to talk first and are no longer in the bishopric. Everyone serving now has approved.",
    );
  });

  it("does not offer Finish while a serving member wants to talk first", () => {
    const state = waitingOnNames(
      pending([said(BISHOP, "approve"), said(FIRST, "talk_first")]),
      [BISHOP, FIRST],
      "bishop",
    );
    expect(state.canFinish).toBe(false);
  });

  it("never offers Finish without a single approval", () => {
    expect(waitingOnNames(pending([]), [], "bishop").canFinish).toBe(false);
    expect(approvalLine(waitingOnNames(pending([]), [], "bishop"))).toBeNull();
  });

  it("keeps a released member's approval in the line — it happened", () => {
    const state = waitingOnNames(pending([said(FIRST, "approve")]), [BISHOP], "bishop");
    expect(state.approvedBy).toEqual(["Tom Haskell"]);
    expect(state.waitingOn).toEqual(["you"]);
  });

  it("does not offer Finish on a decided sign-up", () => {
    const decided = { status: "approved" as const, responses: [said(BISHOP, "approve")] };
    expect(waitingOnNames(decided, [BISHOP], "bishop").canFinish).toBe(false);
  });
});
