// @vitest-environment node
//
// Who may read and write `user_member_links` (ITER-058 cr1, migration 105a).
//
// A SELECT POLICY AND NO WRITE POLICY. You read your own link, the bishopric reads the ward's, and
// nobody else reads any. NO authenticated client may insert, update or delete one — the bishop
// included — because a link decides privileges and the only writer is lib/callings/memberLinks.ts
// on the service role. A refused UPDATE or DELETE is a zero-row success, so those are proven by
// RE-READING with the service client (CLAUDE.md §8).

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

describe("user_member_links (migration 105)", () => {
  let fixtures: Fixtures;
  let bishop: Client;
  let counselor1: Client;
  let eqPresident: Client;
  let rsPresident: Client;
  let wardBBishop: Client;
  let eqMemberId: string;
  let rsMemberId: string;
  let eqLinkId: string;
  let rsLinkId: string;

  const readIds = async (client: Client): Promise<string[]> => {
    const { data, error } = await client.from("user_member_links").select("id");
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.id);
  };

  const reread = async (id: string) => {
    const { data, error } = await fixtures.service
      .from("user_member_links")
      .select("id, status, member_id")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  };

  const insertMember = async (firstName: string): Promise<string> => {
    const { data, error } = await fixtures.service
      .from("members")
      .insert({ ward_id: fixtures.wardAId, first_name: firstName, last_name: `Link ${fixtures.runId}` })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "eqPresident", "rsPresident", "wardBBishop"]);
    [bishop, counselor1, eqPresident, rsPresident, wardBBishop] = await Promise.all([
      asRole(fixtures, "bishop"),
      asRole(fixtures, "counselor1"),
      asRole(fixtures, "eqPresident"),
      asRole(fixtures, "rsPresident"),
      asRole(fixtures, "wardBBishop"),
    ]);

    eqMemberId = await insertMember("Elder");
    rsMemberId = await insertMember("Sister");

    const { data, error } = await fixtures.service
      .from("user_member_links")
      .insert([
        {
          user_id: fixtures.user("eqPresident").id,
          ward_id: fixtures.wardAId,
          member_id: eqMemberId,
          status: "active",
          method: "admin",
          linked_by: fixtures.user("bishop").id,
        },
        {
          user_id: fixtures.user("rsPresident").id,
          ward_id: fixtures.wardAId,
          member_id: rsMemberId,
          status: "active",
          method: "email_match",
        },
      ])
      .select("id, user_id");
    if (error) throw new Error(error.message);
    eqLinkId = data.find((row) => row.user_id === fixtures.user("eqPresident").id)!.id;
    rsLinkId = data.find((row) => row.user_id === fixtures.user("rsPresident").id)!.id;
  }, 120_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("reading", () => {
    it("lets the bishopric read every link in the ward", async () => {
      expect(await readIds(bishop)).toEqual(expect.arrayContaining([eqLinkId, rsLinkId]));
      expect(await readIds(counselor1)).toEqual(expect.arrayContaining([eqLinkId, rsLinkId]));
    });

    it("lets an org president read their own link and no one else's", async () => {
      expect(await readIds(eqPresident)).toEqual([eqLinkId]);
      expect(await readIds(rsPresident)).toEqual([rsLinkId]);
    });

    it("hides ward A's links from ward B's bishop", async () => {
      const visible = await readIds(wardBBishop);
      expect(visible).not.toContain(eqLinkId);
      expect(visible).not.toContain(rsLinkId);
    });
  });

  describe("writing", () => {
    it("refuses an insert from the bishop", async () => {
      const otherMemberId = await insertMember("Another");
      const { error } = await bishop.from("user_member_links").insert({
        user_id: fixtures.user("counselor1").id,
        ward_id: fixtures.wardAId,
        member_id: otherMemberId,
        status: "active",
        method: "admin",
      });
      expect(error).not.toBeNull();
    });

    it("refuses an insert linking your own account, even to a free roster record", async () => {
      const freeMemberId = await insertMember("Free");
      const { error } = await counselor1.from("user_member_links").insert({
        user_id: fixtures.user("counselor1").id,
        ward_id: fixtures.wardAId,
        member_id: freeMemberId,
        status: "active",
        method: "email_match",
      });
      expect(error).not.toBeNull();
    });

    it("changes nothing when the bishop or the owner updates a link", async () => {
      await bishop.from("user_member_links").update({ member_id: rsMemberId, status: "ended" }).eq("id", eqLinkId);
      await eqPresident.from("user_member_links").update({ member_id: rsMemberId }).eq("id", eqLinkId);
      expect(await reread(eqLinkId)).toMatchObject({ status: "active", member_id: eqMemberId });
    });

    it("changes nothing when the bishop or the owner deletes a link", async () => {
      await bishop.from("user_member_links").delete().eq("id", rsLinkId);
      await rsPresident.from("user_member_links").delete().eq("id", rsLinkId);
      expect(await reread(rsLinkId)).not.toBeNull();
    });
  });

  describe("the database rules", () => {
    it("refuses a second active link to one member", async () => {
      const { error } = await fixtures.service.from("user_member_links").insert({
        user_id: fixtures.user("counselor1").id,
        ward_id: fixtures.wardAId,
        member_id: eqMemberId,
        status: "active",
        method: "admin",
      });
      expect(error?.code).toBe("23505");
    });

    it("refuses an active link with no member", async () => {
      const { error } = await fixtures.service.from("user_member_links").insert({
        user_id: fixtures.user("counselor1").id,
        ward_id: fixtures.wardAId,
        status: "active",
        method: "admin",
      });
      expect(error?.code).toBe("23514");
    });

    // A ward-A member nobody is linked to, so only the ward rule can refuse it.
    it("refuses a link to a member of another ward", async () => {
      const unlinkedWardAMemberId = await insertMember("Unlinked");
      const { error } = await fixtures.service.from("user_member_links").insert({
        user_id: fixtures.user("wardBBishop").id,
        ward_id: fixtures.wardBId,
        member_id: unlinkedWardAMemberId,
        status: "active",
        method: "admin",
      });
      expect(error?.code).toBe("23503");
    });
  });
});
