// @vitest-environment node
//
// Who may read and write a stored programme PDF, enforced by the DATABASE rather than by the route.
//
// Migration 040 creates the private `programs` bucket and three policies on storage.objects,
// following migration 032's shape: objects keyed `{ward_id}/…` so `(storage.foldername(name))[1]`
// reads the ward, schema-qualified helpers because `public` is not on the search path when
// evaluating against storage.objects, and NO UPDATE POLICY.
//
// ---------------------------------------------------------------------------------------------
// WHERE THIS DIFFERS FROM MIGRATION 032, ON PURPOSE
// ---------------------------------------------------------------------------------------------
// A knowledge document is bishopric-only. A sacrament programme is read aloud on Sunday and handed
// to everyone in the room, so SELECT is WARD-WIDE and only the writes are narrowed — the same
// split migration 037 made on the `programs` table itself. Both halves are asserted below, because
// "a music coordinator can read it" and "a music coordinator can write it" are different facts and
// only one of them is acceptable.
//
// A REFUSED READ IS AN EMPTY RESULT, NOT AN ERROR — storage's download returns a "not found"-shaped
// failure whether the object is absent or merely invisible, which is the correct behaviour and is
// why the cross-ward assertion below checks that no bytes came back rather than checking a code.
//
// Runs over the network against the shared hosted project (CLAUDE.md §9): every object and fixture
// is removed in afterAll and nothing assumes an empty bucket.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

const BUCKET = "programs";
const WARD_A_DATE = "2027-10-03";
const WARD_B_DATE = "2027-10-10";
const WARD_A_BYTES = "%PDF-1.7 ward A programme";
const WARD_B_BYTES = "%PDF-1.7 ward B programme";

function pdf(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text));
}

describe("program PDF storage access", () => {
  let fixtures: Fixtures;
  let bishopA: SupabaseClient<Database>;
  let secretaryA: SupabaseClient<Database>;
  let musicA: SupabaseClient<Database>;
  let bishopB: SupabaseClient<Database>;

  let wardAKey = "";
  let wardBKey = "";

  async function seed(key: string, text: string): Promise<void> {
    const { error } = await fixtures.service.storage
      .from(BUCKET)
      .upload(key, pdf(text), { contentType: "application/pdf", upsert: true });

    if (error) throw new Error(`Could not seed ${key}: ${error.message}`);
  }

  // Re-reads with the SERVICE client, which bypasses RLS. This is what tells "the write was
  // refused" apart from "the write happened and the reader cannot see it" — the distinction a
  // suite that only inspected the writer's own error would miss entirely.
  async function objectExists(key: string): Promise<boolean> {
    const { data } = await fixtures.service.storage.from(BUCKET).download(key);
    return data !== null;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "wardSecretary", "musicCoordinator", "wardBBishop"]);

    wardAKey = `${fixtures.wardAId}/${WARD_A_DATE}.pdf`;
    wardBKey = `${fixtures.wardBId}/${WARD_B_DATE}.pdf`;

    bishopA = await asRole(fixtures, "bishop");
    secretaryA = await asRole(fixtures, "wardSecretary");
    musicA = await asRole(fixtures, "musicCoordinator");
    bishopB = await asRole(fixtures, "wardBBishop");

    await seed(wardAKey, WARD_A_BYTES);
    await seed(wardBKey, WARD_B_BYTES);
  });

  afterAll(async () => {
    // Objects are not rows: fixtures.cleanup() knows nothing about them, and the hosted project is
    // shared. Removed explicitly, and with the service client so a policy cannot leave litter.
    await fixtures.service.storage.from(BUCKET).remove([wardAKey, wardBKey]);
    await fixtures.cleanup();
  });

  describe("reading", () => {
    it("lets the ward's bishop read their own program", async () => {
      const { data, error } = await bishopA.storage.from(BUCKET).download(wardAKey);

      expect(error).toBeNull();
      expect(await data?.text()).toBe(WARD_A_BYTES);
    });

    // WARD-WIDE, and this is the assertion that says so. A music coordinator holds no program
    // permission at all in lib/auth/permissions.ts, and can still read the programme — because a
    // programme is not private to the bishopric, and the policy says so rather than the route.
    it("lets any member of the ward read it, including one with no program permission", async () => {
      const { data, error } = await musicA.storage.from(BUCKET).download(wardAKey);

      expect(error).toBeNull();
      expect(await data?.text()).toBe(WARD_A_BYTES);
    });

    // THE ONE THIS SUITE EXISTS FOR.
    it("does not let ward B read ward A's program", async () => {
      const { data } = await bishopB.storage.from(BUCKET).download(wardAKey);

      expect(data).toBeNull();
    });

    it("does not let ward A read ward B's program", async () => {
      const { data } = await bishopA.storage.from(BUCKET).download(wardBKey);

      expect(data).toBeNull();
    });
  });

  describe("writing", () => {
    it("lets the ward secretary upload a program", async () => {
      const key = `${fixtures.wardAId}/2027-10-17.pdf`;

      const { error } = await secretaryA.storage
        .from(BUCKET)
        .upload(key, pdf("%PDF-1.7 secretary"), { contentType: "application/pdf" });

      expect(error).toBeNull();
      expect(await objectExists(key)).toBe(true);

      await fixtures.service.storage.from(BUCKET).remove([key]);
    });

    // The write boundary migration 037 drew on the table, drawn again on the bucket. A music
    // coordinator can READ the programme (above) and must not be able to REPLACE it.
    it("does not let a music coordinator upload a program", async () => {
      const key = `${fixtures.wardAId}/2027-10-24.pdf`;

      const { error } = await musicA.storage
        .from(BUCKET)
        .upload(key, pdf("%PDF-1.7 music"), { contentType: "application/pdf" });

      expect(error).not.toBeNull();
      expect(await objectExists(key)).toBe(false);
    });

    it("does not let ward B write into ward A's folder", async () => {
      const key = `${fixtures.wardAId}/2027-10-31.pdf`;

      const { error } = await bishopB.storage
        .from(BUCKET)
        .upload(key, pdf("%PDF-1.7 ward B"), { contentType: "application/pdf" });

      expect(error).not.toBeNull();
      expect(await objectExists(key)).toBe(false);
    });

    // The key shape is load-bearing: the policy reads the ward from the FIRST path segment, so a
    // key built any other way is unreachable by its own uploader. That is the right failure, and
    // it is asserted so nobody "fixes" lib/program/storage.ts into a flat key.
    it("does not let a ward write a key that does not start with its ward id", async () => {
      const { error } = await bishopA.storage
        .from(BUCKET)
        .upload("2027-11-07.pdf", pdf("%PDF-1.7 flat"), { contentType: "application/pdf" });

      expect(error).not.toBeNull();
    });
  });

  describe("replacing", () => {
    // MIGRATION 040 HAS NO UPDATE POLICY, following migration 032. lib/program/storage.ts therefore
    // removes and re-uploads. This asserts the reason that is not a style preference: an upsert
    // issues an UPDATE, which no policy permits, and it fails with a storage error that reads like
    // a permissions bug.
    it("refuses an upsert, which is why storeProgramPdf deletes first", async () => {
      const { error } = await bishopA.storage
        .from(BUCKET)
        .upload(wardAKey, pdf("%PDF-1.7 overwritten"), {
          contentType: "application/pdf",
          upsert: true,
        });

      expect(error).not.toBeNull();

      // And the original is untouched — proved by re-reading, not by trusting the error.
      const { data } = await fixtures.service.storage.from(BUCKET).download(wardAKey);
      expect(await data?.text()).toBe(WARD_A_BYTES);
    });

    it("lets the ward's own builder delete and re-upload", async () => {
      const key = `${fixtures.wardAId}/2027-11-14.pdf`;
      await seed(key, "%PDF-1.7 first");

      const { error: removeError } = await secretaryA.storage.from(BUCKET).remove([key]);
      expect(removeError).toBeNull();

      const { error: uploadError } = await secretaryA.storage
        .from(BUCKET)
        .upload(key, pdf("%PDF-1.7 second"), { contentType: "application/pdf" });
      expect(uploadError).toBeNull();

      const { data } = await fixtures.service.storage.from(BUCKET).download(key);
      expect(await data?.text()).toBe("%PDF-1.7 second");

      await fixtures.service.storage.from(BUCKET).remove([key]);
    });

    it("does not let a music coordinator delete a program", async () => {
      await musicA.storage.from(BUCKET).remove([wardAKey]);

      // A refused DELETE is a zero-row success, not an error — the same trap the table-level RLS
      // suites document. RE-READ, always.
      expect(await objectExists(wardAKey)).toBe(true);
    });

    it("does not let ward B delete ward A's program", async () => {
      await bishopB.storage.from(BUCKET).remove([wardAKey]);

      expect(await objectExists(wardAKey)).toBe(true);
    });
  });
});
