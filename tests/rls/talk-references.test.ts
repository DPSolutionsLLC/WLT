// @vitest-environment node
//
// `talk_references` and the two `sundays` decision columns (migration 079).
//
// READ AND WRITE are the bishopric (migration 080 narrowed the read from `can_view_talks()`).
// There is no UPDATE policy at all. A refused DELETE is a zero-row SUCCESS, so every refusal below is asserted by
// RE-READING the row with the service client rather than by the absence of an error
// (plans/retros/foundation-c-services.md).
//
// Runs over the network against the shared hosted project (CLAUDE.md §9). Every fixture hangs off
// the per-run wards and is deleted by fixtures.cleanup().

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("talk_references RLS", () => {
  let fixtures: Fixtures;
  let bishopA: SupabaseClient<Database>;
  let bishopB: SupabaseClient<Database>;
  let music: SupabaseClient<Database>;
  let orgPresident: SupabaseClient<Database>;

  let sundayAId = "";
  let assignmentAId = "";
  let assignmentBId = "";

  const seedReference = async (citation: string, documentId: string | null = null) => {
    const { data, error } = await fixtures.service
      .from("talk_references")
      .insert({
        ward_id: fixtures.wardAId,
        assignment_id: assignmentAId,
        kind: "scripture",
        citation,
        document_id: documentId,
        source: documentId === null ? "manual" : "search",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  };

  const exists = async (referenceId: string): Promise<boolean> => {
    const { data, error } = await fixtures.service
      .from("talk_references")
      .select("id")
      .eq("id", referenceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data !== null;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "musicCoordinator", "eqPresident", "wardBBishop"]);

    [bishopA, bishopB, music, orgPresident] = await Promise.all([
      asRole(fixtures, "bishop"),
      asRole(fixtures, "wardBBishop"),
      asRole(fixtures, "musicCoordinator"),
      asRole(fixtures, "eqPresident"),
    ]);

    const seedSundayAndAssignment = async (wardId: string) => {
      const { data: sunday, error: sundayError } = await fixtures.service
        .from("sundays")
        .insert({ ward_id: wardId, date: "2027-05-02", type: "standard", speaking_slots: 3 })
        .select("id")
        .single();
      if (sundayError) throw new Error(sundayError.message);

      const { data: assignment, error: assignmentError } = await fixtures.service
        .from("assignments")
        .insert({
          ward_id: wardId,
          sunday_id: sunday.id,
          assignment_type: "sacrament_talk",
          slot_number: 1,
          pipeline_stage: "plan",
        })
        .select("id")
        .single();
      if (assignmentError) throw new Error(assignmentError.message);

      return { sundayId: sunday.id, assignmentId: assignment.id };
    };

    const wardA = await seedSundayAndAssignment(fixtures.wardAId);
    const wardB = await seedSundayAndAssignment(fixtures.wardBId);

    sundayAId = wardA.sundayId;
    assignmentAId = wardA.assignmentId;
    assignmentBId = wardB.assignmentId;
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("lets the bishop insert, read and delete in their own ward", async () => {
    const { data: inserted, error: insertError } = await bishopA
      .from("talk_references")
      .insert({
        ward_id: fixtures.wardAId,
        assignment_id: assignmentAId,
        kind: "talk",
        citation: "A bishop's own reference",
        source: "manual",
      })
      .select("id")
      .single();

    expect(insertError).toBeNull();
    expect(inserted).not.toBeNull();

    const { data: read } = await bishopA
      .from("talk_references")
      .select("id")
      .eq("id", inserted!.id);
    expect(read).toHaveLength(1);

    const { data: deleted, error: deleteError } = await bishopA
      .from("talk_references")
      .delete()
      .eq("id", inserted!.id)
      .select("id");
    expect(deleteError).toBeNull();
    expect(deleted).toHaveLength(1);
    expect(await exists(inserted!.id)).toBe(false);
  });

  it("hides ward A's references from ward B's bishop", async () => {
    const referenceId = await seedReference("Ward A only");

    const { data } = await bishopB.from("talk_references").select("id").eq("id", referenceId);

    expect(data).toEqual([]);
  });

  it("refuses ward B's bishop an insert against a ward A assignment", async () => {
    const { error } = await bishopB.from("talk_references").insert({
      ward_id: fixtures.wardAId,
      assignment_id: assignmentAId,
      kind: "scripture",
      citation: "Cross-ward attempt",
      source: "manual",
    });

    expect(error).not.toBeNull();
  });

  // The composite foreign key proves the WARD: a ward A row cannot point at ward B's talk.
  it("refuses an insert pointing at another ward's assignment", async () => {
    const { error } = await bishopA.from("talk_references").insert({
      ward_id: fixtures.wardAId,
      assignment_id: assignmentBId,
      kind: "scripture",
      citation: "Wrong ward's talk",
      source: "manual",
    });

    expect(error).not.toBeNull();
  });

  // Defect 074-D2, migration 080: a music coordinator holds `talks.view` and reads NOTHING here.
  it("shows a music coordinator nothing and lets them write nothing", async () => {
    const referenceId = await seedReference("Not for music");

    const { data: read } = await music.from("talk_references").select("id").eq("id", referenceId);
    expect(read).toEqual([]);

    const { error: insertError } = await music.from("talk_references").insert({
      ward_id: fixtures.wardAId,
      assignment_id: assignmentAId,
      kind: "scripture",
      citation: "Music tries to add",
      source: "manual",
    });
    expect(insertError).not.toBeNull();

    await music.from("talk_references").delete().eq("id", referenceId);
    expect(await exists(referenceId)).toBe(true);
  });

  it("shows an org president nothing", async () => {
    const referenceId = await seedReference("Not for org presidents");

    const { data } = await orgPresident
      .from("talk_references")
      .select("id")
      .eq("id", referenceId);

    expect(data).toEqual([]);
  });

  // decisions.md §1.1 — deleting the source keeps the citation a person chose.
  it("keeps the citation and drops only the link when its document is deleted", async () => {
    const { data: document, error: documentError } = await fixtures.service
      .from("knowledge_documents")
      .insert({ ward_id: fixtures.wardAId, title: "Doomed document", type_tag: "other" })
      .select("id")
      .single();
    if (documentError) throw new Error(documentError.message);

    const referenceId = await seedReference("From the doomed document", document.id);

    const { error: deleteError } = await fixtures.service
      .from("knowledge_documents")
      .delete()
      .eq("id", document.id);
    expect(deleteError).toBeNull();

    const { data } = await fixtures.service
      .from("talk_references")
      .select("citation, document_id, ward_id")
      .eq("id", referenceId)
      .single();

    expect(data).toEqual({
      citation: "From the doomed document",
      document_id: null,
      ward_id: fixtures.wardAId,
    });
  });

  it("refuses a manual reference that claims a document", async () => {
    const { data: document, error: documentError } = await fixtures.service
      .from("knowledge_documents")
      .insert({ ward_id: fixtures.wardAId, title: "Claimed document", type_tag: "other" })
      .select("id")
      .single();
    if (documentError) throw new Error(documentError.message);

    const { error } = await fixtures.service.from("talk_references").insert({
      ward_id: fixtures.wardAId,
      assignment_id: assignmentAId,
      kind: "scripture",
      citation: "Manual with a document",
      document_id: document.id,
      source: "manual",
    });

    expect(error).not.toBeNull();
  });

  it("refuses a Sunday that is both finalized and skipped", async () => {
    const now = new Date().toISOString();

    const { error } = await fixtures.service
      .from("sundays")
      .update({ references_finalized_at: now, references_skipped_at: now })
      .eq("id", sundayAId);

    expect(error).not.toBeNull();

    const { data } = await fixtures.service
      .from("sundays")
      .select("references_finalized_at, references_skipped_at")
      .eq("id", sundayAId)
      .single();
    expect(data).toEqual({ references_finalized_at: null, references_skipped_at: null });
  });
});
