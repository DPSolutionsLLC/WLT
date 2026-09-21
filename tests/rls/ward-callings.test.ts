// @vitest-environment node
//
// THE HIGHEST-VALUE SUITE IN PHASE 2, and the one that replaces tests/rls/unit-switching.test.ts.
//
// That suite tested a VISITING OFFICER: one person, one role, borrowing another ward under a
// reduced permission list. The model is that a person is GIVEN A REAL CALLING IN EACH WARD they
// need, and carries that ward's role and that ward's access while acting there. Its assertions
// are not fixable one by one — "a stake president may switch into a ward under their stake" is
// now false by design, and "a visitor has no organization there" is the exact thing migration
// 070b reverses — so it is replaced rather than edited.
//
// The ward switch does not widen a single policy. It changes which ward current_ward_id() answers
// with, and which CALLING current_user_role() and current_org_id() read; every one of the 131
// policies that already says `ward_id = current_ward_id()` follows. That is cheap and it is also
// the whole risk: four functions decide what a person can reach in every ward they hold a calling
// in.
//
// EVERY CASE RE-READS WITH THE SERVICE CLIENT where it asserts a write. An RLS-denied UPDATE is a
// zero-row SUCCESS and a WITH CHECK failure is a RAISE, so asserting only "an error came back"
// can pass for the wrong reason and asserting only "no error came back" can pass while nothing
// was written.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

async function setActiveWard(
  client: SupabaseClient<Database>,
  userId: string,
  wardId: string | null,
): Promise<{ code?: string; message?: string } | null> {
  const { error } = await client
    .from("users")
    .update({ active_ward_id: wardId })
    .eq("id", userId);
  return error;
}

async function readActiveWard(fixtures: Fixtures, userId: string): Promise<string | null> {
  const { data } = await fixtures.service
    .from("users")
    .select("active_ward_id")
    .eq("id", userId)
    .single();
  return data?.active_ward_id ?? null;
}

type SessionContext = {
  ward_id: string;
  home_ward_id: string;
  active_ward_id: string | null;
  role: string | null;
  org_id: string | null;
  counselor_position: number | null;
  calling_id: string | null;
  is_bishopric: boolean;
};

// session_context() is one round trip returning everything the four helpers answer, which is what
// lib/auth/session.ts reads. Asserting through it rather than through four separate RPCs is
// deliberate: the app can only ever see these values TOGETHER, so a test that could pass with
// them disagreeing would be testing a state the app cannot reach.
async function readContext(client: SupabaseClient<Database>): Promise<SessionContext> {
  const { data, error } = await client.rpc("session_context");
  if (error) throw new Error(`session_context() failed: ${error.message}`);
  const context = data?.[0];
  if (!context) throw new Error("session_context() returned no row");
  return context as unknown as SessionContext;
}

describe("a calling in each ward", () => {
  let fixtures: Fixtures;
  let twoCallings: SupabaseClient<Database>;
  let bishopAway: SupabaseClient<Database>;
  let eqPresident: SupabaseClient<Database>;

  const wardBRows = {
    householdId: "",
    visitLogId: "",
    privateNoteId: "",
  };

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "eqPresident",
      "wardBBishop",
      "wardBEqPresident",
      "twoCallings",
      "twoCallingsBishopAway",
    ]);

    twoCallings = await asRole(fixtures, "twoCallings");
    bishopAway = await asRole(fixtures, "twoCallingsBishopAway");
    eqPresident = await asRole(fixtures, "eqPresident");

    // Ward B data, written with the service client so RLS has nothing to do with whether it
    // exists — only with whether somebody acting there can read it.
    const { data: household, error: householdError } = await fixtures.service
      .from("households")
      .insert({ ward_id: fixtures.wardBId, family_name: `Calling ${fixtures.runId}` })
      .select("id")
      .single();
    if (householdError) throw new Error(householdError.message);
    wardBRows.householdId = household.id;

    const { data: visitLog, error: visitLogError } = await fixtures.service
      .from("visit_logs")
      .insert({
        ward_id: fixtures.wardBId,
        org_id: fixtures.wardBOrgId,
        household_id: household.id,
        visit_date: "2026-03-01",
        shared_notes: "ward B shared",
        recorded_by: fixtures.user("wardBEqPresident").id,
      })
      .select("id")
      .single();
    if (visitLogError) throw new Error(visitLogError.message);
    wardBRows.visitLogId = visitLog.id;

    // Authored by ward B's BISHOP, so it belongs to somebody in ward B and to nobody the
    // second-calling person could claim to be. Rule 5 is what this row exists to prove.
    const { data: note, error: noteError } = await fixtures.service
      .from("visit_private_notes")
      .insert({
        ward_id: fixtures.wardBId,
        visit_log_id: visitLog.id,
        user_id: fixtures.user("wardBBishop").id,
        notes: "PRIVATE: must never leave ward B",
      })
      .select("id")
      .single();
    if (noteError) throw new Error(noteError.message);
    wardBRows.privateNoteId = note.id;
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  // ---------------------------------------------------------------------------
  // THE NO-OP PROOF
  // ---------------------------------------------------------------------------
  //
  // Everything migrations 068–070 do is invisible to somebody with one calling, which is every
  // leader in every real ward today. If this section breaks, the sequence is not deployable at
  // all, whatever the rest of the file says.

  describe("a person with one calling", () => {
    it("reads their own ward, their own role and their own organization", async () => {
      const context = await readContext(eqPresident);

      expect(context.ward_id).toBe(fixtures.wardAId);
      expect(context.home_ward_id).toBe(fixtures.wardAId);
      expect(context.active_ward_id).toBeNull();
      expect(context.role).toBe("org_president");
      expect(context.org_id).toBe(fixtures.eldersQuorumId);
      expect(context.is_bishopric).toBe(false);
      expect(context.calling_id).not.toBeNull();
    });

    it("cannot switch into a ward they hold no calling in", async () => {
      const selfId = fixtures.user("eqPresident").id;

      const error = await setActiveWard(eqPresident, selfId, fixtures.wardBId);

      // A WITH CHECK failure RAISES (42501) where almost every other refusal here is a zero-row
      // success — which is why lib/units/wardSwitch.ts maps it, and why the re-read matters.
      expect(error).not.toBeNull();
      expect(await readActiveWard(fixtures, selfId)).toBeNull();
    });

    // Clearing can never need authorization (migration 066d). Somebody who could not have
    // switched in the first place must still be able to run the "back to my ward" control.
    it("may always clear the switch", async () => {
      const selfId = fixtures.user("eqPresident").id;

      expect(await setActiveWard(eqPresident, selfId, null)).toBeNull();
      expect(await readActiveWard(fixtures, selfId)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // THE ASSERTION proto-c GOT BACKWARDS
  // ---------------------------------------------------------------------------
  //
  // Migration 066's header said "the role travels with the person, only the ward changes".
  // Migration 070b reverses it: the role belongs to the calling in that ward.

  describe("one person, two callings", () => {
    const selfOf = (handle: "twoCallings" | "twoCallingsBishopAway") =>
      fixtures.user(handle).id;

    afterAll(async () => {
      await setActiveWard(twoCallings, selfOf("twoCallings"), null);
      await setActiveWard(bishopAway, selfOf("twoCallingsBishopAway"), null);
    });

    it("is their ward A role at home", async () => {
      await setActiveWard(twoCallings, selfOf("twoCallings"), null);
      const context = await readContext(twoCallings);

      expect(context.ward_id).toBe(fixtures.wardAId);
      expect(context.role).toBe("org_president");
      expect(context.org_id).toBe(fixtures.reliefSocietyId);
    });

    it("may switch into the ward they hold a second calling in", async () => {
      const selfId = selfOf("twoCallings");

      expect(await setActiveWard(twoCallings, selfId, fixtures.wardBId)).toBeNull();
      expect(await readActiveWard(fixtures, selfId)).toBe(fixtures.wardBId);
    });

    // THE REVERSAL, asserted directly. Same account, same request a moment later, different role
    // — because the role is the calling's and the calling is the ward's.
    it("is their ward B role after the switch", async () => {
      const context = await readContext(twoCallings);

      expect(context.ward_id).toBe(fixtures.wardBId);
      expect(context.home_ward_id).toBe(fixtures.wardAId);
      expect(context.role).toBe("ward_secretary");
    });

    // Migration 066 returned NULL here, by a deliberate argument that dies with the visitor:
    // their organization is a real organization IN THE WARD THEY ARE ACTING IN, or null because
    // that calling has none. `ward_secretary` has none, so the correct answer is null — and it is
    // emphatically NOT ward A's Relief Society, which is the leak 066 was guarding against and
    // which this model closes at the source instead.
    it("has the calling's own organization in ward B, never ward A's", async () => {
      const context = await readContext(twoCallings);

      expect(context.org_id).not.toBe(fixtures.reliefSocietyId);
      expect(context.org_id).toBeNull();
    });

    it("carries a different calling id in each ward", async () => {
      const inWardB = (await readContext(twoCallings)).calling_id;

      await setActiveWard(twoCallings, selfOf("twoCallings"), null);
      const atHome = (await readContext(twoCallings)).calling_id;

      expect(inWardB).not.toBeNull();
      expect(atHome).not.toBeNull();
      expect(inWardB).not.toBe(atHome);
    });

    // ONE PERSON, BOTH ANSWERS. is_bishopric() lost migration 066's `and acting_in_home_ward()`
    // and simply asks the active calling's role — so somebody who is a music coordinator at home
    // and a bishop in ward B is not bishopric here and is bishopric there.
    it("is bishopric in the ward whose calling is bishop, and not in the other", async () => {
      const selfId = selfOf("twoCallingsBishopAway");

      await setActiveWard(bishopAway, selfId, null);
      const atHome = await readContext(bishopAway);
      expect(atHome.role).toBe("music_coordinator");
      expect(atHome.is_bishopric).toBe(false);

      expect(await setActiveWard(bishopAway, selfId, fixtures.wardBId)).toBeNull();
      const away = await readContext(bishopAway);
      expect(away.role).toBe("bishop");
      expect(away.is_bishopric).toBe(true);
    });

    // 066c's `or id = auth.uid()` arm, still load-bearing under 070d. Without it
    // lib/auth/session.ts reads nothing, treats it as a half-created account and redirects to
    // /login — the switch would sign the switcher out, and nothing about that looks like
    // permissions.
    it("still reads its own users row while acting in ward B", async () => {
      const selfId = selfOf("twoCallings");
      await setActiveWard(twoCallings, selfId, fixtures.wardBId);

      const { data, error } = await twoCallings
        .from("users")
        .select("id, ward_id")
        .eq("id", selfId)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data?.id).toBe(selfId);
      expect(data?.ward_id).toBe(fixtures.wardAId);
    });

    // Migration 070d's new arm. A person who holds a calling in this ward is one of THIS ward's
    // leaders and must be readable as such, or they are silently missing from the admin list with
    // no error anywhere.
    it("is visible to the ward they hold a second calling in", async () => {
      const wardBBishopClient = await asRole(fixtures, "wardBBishop");

      const { data, error } = await wardBBishopClient
        .from("users")
        .select("id")
        .eq("id", selfOf("twoCallings"))
        .maybeSingle();

      expect(error).toBeNull();
      expect(data?.id).toBe(selfOf("twoCallings"));
    });

    it("reads ward B's households while acting there", async () => {
      await setActiveWard(twoCallings, selfOf("twoCallings"), fixtures.wardBId);

      const { data, error } = await twoCallings
        .from("households")
        .select("id")
        .eq("id", wardBRows.householdId);

      expect(error).toBeNull();
      expect(data?.map((row) => row.id)).toEqual([wardBRows.householdId]);
    });

    // A SECOND CALLING REACHES EXACTLY TWO WARDS. Ward A's rows are unreadable while acting in
    // ward B — that is not a bug, it is the model: you are a ward B leader there, nothing more
    // and nothing less. There is no cross-ward read in either direction.
    it("cannot read its own home ward's households while acting in ward B", async () => {
      await setActiveWard(twoCallings, selfOf("twoCallings"), fixtures.wardBId);

      const { data, error } = await twoCallings
        .from("households")
        .select("id")
        .eq("ward_id", fixtures.wardAId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // RULE 5. PRIVATE NOTES NEVER WIDEN, BY ANY ROUTE.
  // ---------------------------------------------------------------------------
  //
  // `visit_private_notes` and `activity_private_notes` are `user_id = auth.uid()` and nothing
  // else. A second calling grants a ward's ORDINARY access, and a private note has never been
  // part of that for anybody — not the bishop, not an admin, not a support query.

  describe("private notes", () => {
    it("stay invisible in the ward the second calling is in", async () => {
      await setActiveWard(twoCallings, fixtures.user("twoCallings").id, fixtures.wardBId);

      const { data, error } = await twoCallings
        .from("visit_private_notes")
        .select("id")
        .eq("id", wardBRows.privateNoteId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    // Asserted on BOTH sides of the switch, because "invisible from over there" and "invisible
    // from back home" are two different predicates failing for two different reasons, and a
    // regression could restore either one alone.
    it("stay invisible from the home ward too", async () => {
      await setActiveWard(twoCallings, fixtures.user("twoCallings").id, null);

      const { data, error } = await twoCallings
        .from("visit_private_notes")
        .select("id")
        .eq("id", wardBRows.privateNoteId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    // Even a BISHOP calling does not reach it. This is the case most likely to be "fixed" by
    // somebody who reads rule 5 as being about visitors rather than about everybody.
    it("stay invisible to somebody whose second calling is bishop of that ward", async () => {
      await setActiveWard(
        bishopAway,
        fixtures.user("twoCallingsBishopAway").id,
        fixtures.wardBId,
      );

      const { data, error } = await bishopAway
        .from("visit_private_notes")
        .select("id")
        .eq("id", wardBRows.privateNoteId);

      expect(error).toBeNull();
      expect(data).toEqual([]);

      await setActiveWard(bishopAway, fixtures.user("twoCallingsBishopAway").id, null);
    });
  });

  // ---------------------------------------------------------------------------
  // REVOCATION IS IMMEDIATE
  // ---------------------------------------------------------------------------
  //
  // current_ward_id() RE-VALIDATES ON EVERY READ (migration 070b) rather than trusting the column
  // it wrote. plans/P2-unit-hierarchy.md writes it as a plain coalesce, which would authorize the
  // switch once, at write time, for ever: end somebody's second calling on Sunday and their
  // session keeps reading ward B until somebody remembers to null the column.

  describe("ending the second calling", () => {
    it("takes effect on the NEXT READ, with active_ward_id still set", async () => {
      const selfId = fixtures.user("twoCallings").id;

      expect(await setActiveWard(twoCallings, selfId, fixtures.wardBId)).toBeNull();
      expect((await readContext(twoCallings)).ward_id).toBe(fixtures.wardBId);

      const { error: releaseError } = await fixtures.service
        .from("ward_role_assignments")
        .update({ is_active: false })
        .eq("user_id", selfId)
        .eq("ward_id", fixtures.wardBId);
      expect(releaseError).toBeNull();

      try {
        // The column is UNCHANGED — nothing nulled it — and the session is home anyway. That gap
        // between "what was written" and "what is true" is the whole point of re-validating.
        expect(await readActiveWard(fixtures, selfId)).toBe(fixtures.wardBId);

        const context = await readContext(twoCallings);
        expect(context.ward_id).toBe(fixtures.wardAId);
        expect(context.role).toBe("org_president");
        expect(context.org_id).toBe(fixtures.reliefSocietyId);
      } finally {
        await fixtures.service
          .from("ward_role_assignments")
          .update({ is_active: true })
          .eq("user_id", selfId)
          .eq("ward_id", fixtures.wardBId);
        await setActiveWard(twoCallings, selfId, null);
      }
    });

    // A calling on a DEACTIVATED ACCOUNT authorizes nothing either: can_act_in_ward() joins
    // `users.is_active` on top of the calling's own (migration 070a). The two columns are
    // deliberately separate facts — see lib/callings/writeCalling.ts — and this is what makes
    // keeping them separate safe.
    it("is also refused while the account itself is deactivated", async () => {
      const selfId = fixtures.user("twoCallings").id;

      const { error: deactivateError } = await fixtures.service
        .from("users")
        .update({ is_active: false })
        .eq("id", selfId);
      expect(deactivateError).toBeNull();

      try {
        expect(
          await setActiveWard(twoCallings, selfId, fixtures.wardBId),
        ).not.toBeNull();
        expect(await readActiveWard(fixtures, selfId)).toBeNull();
      } finally {
        await fixtures.service
          .from("users")
          .update({ is_active: true })
          .eq("id", selfId);
      }
    });
  });
});
