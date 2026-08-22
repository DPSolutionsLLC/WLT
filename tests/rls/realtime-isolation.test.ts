// @vitest-environment node
//
// THIS TEST IS WHAT EARNS MIGRATION 026 THE RIGHT TO SHIP.
//
// Adding a table to the supabase_realtime publication is a privacy decision. Supabase applies RLS
// to postgres_changes before delivering them, but this project's rule is that RLS is the boundary
// and is PROVEN rather than assumed (CLAUDE.md rule 2). Until this suite passes, migration 026 is
// an unproven cross-ward leak and must not ship.
//
// The CommentThread component subscribes with a ward_id filter, but that is a client-side
// convenience: a modified client could simply drop it. What is asserted here is the SERVER-side
// boundary, which is why the second scenario subscribes with no filter at all.
//
// ---------------------------------------------------------------------------
// WHY EVERY NEGATIVE HERE CARRIES A CONTROL ROW
// ---------------------------------------------------------------------------
// "Wait N seconds, see nothing, declare privacy" is not a proof. It is indistinguishable from a
// channel that had not finished warming up, a publication that was never applied, or realtime
// being switched off — all of which this project has actually been in at some point. The first
// version of this suite worked that way and passed all three negatives while realtime was
// entirely dead.
//
// So every negative test inserts TWO rows: the forbidden one FIRST, then a control the subscriber
// is entitled to receive. The assertion waits for the CONTROL to arrive and only then checks that
// the forbidden one did not. Because Postgres streams WAL in commit order, a control that arrives
// proves the subscriber was live and had already been offered everything committed before it — so
// "the forbidden row is absent" means it was refused, not merely late.
//
// This also makes the suite fast: it returns as soon as the control lands instead of always
// paying a wall-clock timeout.
//
// Requires migration 026 (`npm run db:push`). Without it the control never arrives and every test
// here fails loudly, which is the intended behaviour.
//
// Runs over the network against the shared hosted project (CLAUDE.md §9).

import type { RealtimeChannel } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures, type FixtureHandle } from "@/tests/helpers/seed";

const SUNDAY_DATE = "2027-07-04";

// Only ever waited out in full when something is genuinely wrong: a control row that never
// arrives fails the test rather than passing it.
const CONTROL_TIMEOUT_MS = 25_000;
const SUBSCRIBE_TIMEOUT_MS = 20_000;

// `SUBSCRIBED` IS NOT READINESS. It acknowledges the channel JOIN; the server still has to
// register the subscription and WALRUS still has to pick it up, and that lag is not reported to
// the client at all. Run alone, the first event arrives in about a second. Run inside the full
// suite against a busy project, the same first event has taken over 25 seconds — long enough to
// fail a test whose own control row was the thing being waited on.
//
// So every channel that is entitled to receive something is warmed by PROBING until a row
// actually arrives, before any assertion depends on it. Probes are re-inserted rather than
// waited on, because a change committed before the subscription went live is gone — waiting
// longer on one insert cannot recover it.
const PROBE_WINDOW_MS = 3_000;
const LIVENESS_TIMEOUT_MS = 90_000;

type ReceivedRow = { id: string; wardId: string };

type Subscription = {
  handle: FixtureHandle;
  channel: RealtimeChannel;
  received: ReceivedRow[];
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("realtime isolation for assignment_comments", () => {
  let fixtures: Fixtures;

  let wardAAssignmentId = "";
  let wardBAssignmentId = "";

  const subscriptions: Subscription[] = [];

  async function subscribeAs(
    handle: FixtureHandle,
    channelName: string,
    filter?: string,
  ): Promise<Subscription> {
    const client = await asRole(fixtures, handle);

    // Realtime authenticates separately from PostgREST. Without the access token on the socket
    // the connection is anonymous and every policy refuses it, which would make each negative
    // assertion below pass for entirely the wrong reason.
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session) throw new Error(`Fixture "${handle}" has no session for realtime`);
    await client.realtime.setAuth(session.access_token);

    const received: ReceivedRow[] = [];
    const channel = client.channel(`${channelName}-${fixtures.runId}`);

    channel.on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "assignment_comments",
        ...(filter ? { filter } : {}),
      },
      (payload) => {
        const row = payload.new as { id: string; ward_id: string };
        received.push({ id: row.id, wardId: row.ward_id });
      },
    );

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Channel "${channelName}" never reached SUBSCRIBED`)),
        SUBSCRIBE_TIMEOUT_MS,
      );

      channel.subscribe((status, error) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          resolve();
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          reject(
            new Error(
              `Channel "${channelName}" failed: ${status}${error ? ` — ${error.message}` : ""}`,
            ),
          );
        }
      });
    });

    const subscription = { handle, channel, received };
    subscriptions.push(subscription);
    return subscription;
  }

  async function insertComment(
    wardId: string,
    assignmentId: string,
    comment: string,
  ): Promise<string> {
    const { data, error } = await fixtures.service
      .from("assignment_comments")
      .insert({
        ward_id: wardId,
        assignment_id: assignmentId,
        user_id: fixtures.user(wardId === fixtures.wardAId ? "bishop" : "wardBBishop").id,
        comment,
        level: "assignment",
      })
      .select("id")
      .single();

    if (error) throw new Error(`Could not insert a comment: ${error.message}`);
    return data.id;
  }

  function hasReceived(received: ReceivedRow[], commentId: string): boolean {
    return received.some((row) => row.id === commentId);
  }

  // Proves the channel is genuinely delivering before anything depends on it, by inserting a row
  // this subscriber may see and re-inserting until one arrives. Clears `received` afterwards so
  // the probes cannot be mistaken for a control row or pollute an "expect nothing" assertion.
  async function waitUntilLive(
    subscription: Subscription,
    wardId: string,
    assignmentId: string,
  ): Promise<void> {
    const deadline = Date.now() + LIVENESS_TIMEOUT_MS;
    let attempt = 0;

    while (Date.now() < deadline) {
      attempt += 1;
      const probeId = await insertComment(
        wardId,
        assignmentId,
        `liveness probe ${attempt}`,
      );

      const window = Date.now() + PROBE_WINDOW_MS;
      while (Date.now() < window) {
        if (hasReceived(subscription.received, probeId)) {
          subscription.received.length = 0;
          return;
        }
        await wait(200);
      }
    }

    throw new Error(
      `Channel for "${subscription.handle}" reported SUBSCRIBED but never delivered a probe ` +
        `row in ${LIVENESS_TIMEOUT_MS / 1000}s across ${attempt} attempts. Either migration 026 ` +
        "has not been applied (npm run db:push) or realtime is not delivering for this project.",
    );
  }

  // Fails the test rather than returning false. A control that never lands means the subscriber
  // was not live, and every conclusion drawn from its silence would be worthless.
  async function awaitControl(
    subscription: Subscription,
    controlId: string,
  ): Promise<void> {
    const deadline = Date.now() + CONTROL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (hasReceived(subscription.received, controlId)) return;
      await wait(200);
    }

    throw new Error(
      `The control row never reached "${subscription.handle}", so this subscriber was not ` +
        "receiving anything and its silence proves nothing. Check that migration 026 has been " +
        "applied (npm run db:push) before reading any other failure in this file.",
    );
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "musicCoordinator", "wardBBishop"]);

    const seedSunday = async (wardId: string) => {
      const { data, error } = await fixtures.service
        .from("sundays")
        .insert({
          ward_id: wardId,
          date: SUNDAY_DATE,
          type: "standard",
          speaking_slots: 3,
        })
        .select("id")
        .single();
      if (error) throw new Error(`Could not seed a Sunday: ${error.message}`);
      return data.id;
    };

    const seedAssignment = async (wardId: string, sundayId: string) => {
      const { data, error } = await fixtures.service
        .from("assignments")
        .insert({
          ward_id: wardId,
          sunday_id: sundayId,
          assignment_type: "sacrament_talk",
          slot_number: 1,
          pipeline_stage: "plan",
        })
        .select("id")
        .single();
      if (error) throw new Error(`Could not seed an assignment: ${error.message}`);
      return data.id;
    };

    wardAAssignmentId = await seedAssignment(
      fixtures.wardAId,
      await seedSunday(fixtures.wardAId),
    );
    wardBAssignmentId = await seedAssignment(
      fixtures.wardBId,
      await seedSunday(fixtures.wardBId),
    );
  });

  afterAll(async () => {
    // A leaked channel keeps the suite's socket open and the whole run hangs after the last
    // assertion passes. Unsubscribe first, then drop the socket.
    for (const { channel } of subscriptions) {
      try {
        await channel.unsubscribe();
      } catch (error) {
        console.warn("Could not unsubscribe a realtime channel", error);
      }
    }

    for (const handle of ["bishop", "musicCoordinator", "wardBBishop"] as const) {
      const client = await asRole(fixtures, handle);
      await client.removeAllChannels();
      client.realtime.disconnect();
    }

    await fixtures?.cleanup();
  });

  // Listed first deliberately: if a ward cannot receive its OWN comments then realtime is not
  // working at all, and nothing else in this file means anything.
  it("delivers a ward's own comment to that ward's bishop", async () => {
    const bishop = await subscribeAs("bishop", "ward-a-own");
    await waitUntilLive(bishop, fixtures.wardAId, wardAAssignmentId);

    const commentId = await insertComment(
      fixtures.wardAId,
      wardAAssignmentId,
      "Live update check",
    );

    await awaitControl(bishop, commentId);

    expect(hasReceived(bishop.received, commentId)).toBe(true);
  });

  it("never delivers ward A's comment to a ward B subscriber", async () => {
    const wardB = await subscribeAs(
      "wardBBishop",
      "ward-b-filtered",
      `ward_id=eq.${fixtures.wardBId}`,
    );
    await waitUntilLive(wardB, fixtures.wardBId, wardBAssignmentId);

    // Forbidden first, control second. WAL is streamed in commit order, so a subscriber that has
    // been offered the control has already been offered — and refused — the one before it.
    const forbiddenId = await insertComment(
      fixtures.wardAId,
      wardAAssignmentId,
      "Ward A only",
    );
    const controlId = await insertComment(
      fixtures.wardBId,
      wardBAssignmentId,
      "Ward B control",
    );

    await awaitControl(wardB, controlId);

    expect(
      hasReceived(wardB.received, forbiddenId),
      "Ward B received a ward A comment over realtime",
    ).toBe(false);
    expect(wardB.received.every((row) => row.wardId === fixtures.wardBId)).toBe(true);
  });

  // The one that matters most. No client-side filter at all, so nothing but the server's own
  // policy stands between ward A's bishop and ward B's rows. A modified client can drop the
  // filter the CommentThread component sends; it cannot drop this.
  it("never delivers ward B's comment to an UNFILTERED ward A subscriber", async () => {
    const wardA = await subscribeAs("bishop", "ward-a-unfiltered");
    await waitUntilLive(wardA, fixtures.wardAId, wardAAssignmentId);

    const forbiddenId = await insertComment(
      fixtures.wardBId,
      wardBAssignmentId,
      "Ward B only",
    );
    const controlId = await insertComment(
      fixtures.wardAId,
      wardAAssignmentId,
      "Ward A control",
    );

    await awaitControl(wardA, controlId);

    expect(
      hasReceived(wardA.received, forbiddenId),
      "An unfiltered ward A subscriber received a ward B comment",
    ).toBe(false);
    expect(
      wardA.received.some((row) => row.wardId === fixtures.wardBId),
      "A ward B row reached a ward A subscriber",
    ).toBe(false);
  });

  // Same ward, wrong role. music_coordinator holds talks.view in the permission matrix, but
  // migration 019 puts assignment_comments in the bishopric-only policy loop — and it is the
  // POLICY that governs realtime delivery, not the permission matrix. Realtime bypasses every
  // route handler, so assertCan is not in the path at all here.
  //
  // There is no row this subscriber may legitimately receive, so the control cannot be its own.
  // The bishop's channel plays that part: it proves the insert really was published and delivered
  // to somebody, which is what makes the music coordinator's silence a refusal rather than a
  // pipeline that was asleep.
  it("delivers nothing to a non-bishopric role inside the same ward", async () => {
    // Subscribed FIRST, and deliberately not warmed — there is no row in this table a music
    // coordinator may legitimately receive, so no probe can prove their channel is live. That
    // limit is real and worth stating rather than papering over.
    //
    // What makes the silence meaningful anyway: the bishop's warm-up below inserts probe rows
    // into ward A and blocks until they arrive. Those probes are themselves rows this subscriber
    // must not see, they span the whole warm-up window, and the final assertion checks this
    // channel received NOTHING across all of it — not just the one control row.
    const music = await subscribeAs("musicCoordinator", "ward-a-music");
    const bishop = await subscribeAs("bishop", "ward-a-music-control");
    await waitUntilLive(bishop, fixtures.wardAId, wardAAssignmentId);

    const commentId = await insertComment(
      fixtures.wardAId,
      wardAAssignmentId,
      "Bishopric only",
    );

    await awaitControl(bishop, commentId);

    expect(
      hasReceived(music.received, commentId),
      "The music coordinator received a bishopric-only comment over realtime",
    ).toBe(false);
    expect(music.received).toEqual([]);
  });
});
