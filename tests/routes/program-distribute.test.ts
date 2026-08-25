// @vitest-environment node
//
// The two program-d routes, called as functions.
//
// See tests/helpers/routeClient.ts for why this needs no server, and read its header comment
// before editing the vi.mock below — the hoisting trap is the likeliest hour to lose. Only
// @/lib/supabase/server and @/lib/email/resend are mocked, so every query still runs against the
// hosted project as a genuinely authenticated user and a passing test proves RLS allowed it.
//
// ---------------------------------------------------------------------------------------------
// WHY RESEND IS MOCKED AND SUPABASE IS NOT
// ---------------------------------------------------------------------------------------------
// Supabase is the thing under test: the point of a route test here is that the policy let the
// query through. Resend is a third party with a low free-tier quota whose sender is unverified
// (plans/retros/deployment.md), so a real send would prove nothing and cost something.
//
// ---------------------------------------------------------------------------------------------
// THE PROPERTY THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------------------------
// DISTRIBUTION IS THE ONE STEP WITH NO UNDO. Every refusal below is a refusal that has to happen
// BEFORE anything is sent — a wrong 200 here cannot be corrected by a later commit.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  actAs,
  errorMessage,
  jsonRequest,
  readResponse,
} from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database, Json } from "@/types/database";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const sendMock = vi.fn();
const configurationMock = vi.fn();

vi.mock("@/lib/email/resend", () => ({
  emailConfiguration: () => configurationMock(),
  getResendClient: () => ({ emails: { send: sendMock } }),
}));

const SUNDAY_DATE = "2027-09-05";
const RECIPIENTS = ["secretary@example.test", "bishop@example.test"];
const LIBRARIAN = "librarian@example.test";

async function callGenerate(programId: string) {
  const { POST } = await import("@/app/api/programs/[id]/generate-pdf/route");
  return readResponse(
    await POST(
      jsonRequest(`http://localhost/api/programs/${programId}/generate-pdf`, {
        method: "POST",
        body: {},
      }),
      { params: Promise.resolve({ id: programId }) },
    ),
  );
}

async function callDistribute(programId: string, body: unknown = {}) {
  const { POST } = await import("@/app/api/programs/[id]/distribute/route");
  return readResponse(
    await POST(
      jsonRequest(`http://localhost/api/programs/${programId}/distribute`, {
        method: "POST",
        body,
      }),
      { params: Promise.resolve({ id: programId }) },
    ),
  );
}

describe("the program distribution routes", () => {
  let fixtures: Fixtures;
  let sundayId = "";
  let programId = "";

  // A minimal but valid draft. programDraftSchema is strict about `version` being the literal 1,
  // so a stored draft that does not parse would surface as a 409 rather than as the thing under
  // test — which is exactly why mapProgramRow parses rather than casts.
  function draft(date: string) {
    return {
      version: 1,
      heading: null,
      date,
      sundayType: "standard",
      presiding: { printedName: "Mark Andersen", publicName: "Mark Andersen" },
      conducting: { printedName: "Peter Lindqvist", publicName: "Peter Lindqvist" },
      organist: null,
      chorister: null,
      openingHymn: { number: 19, title: "We Thank Thee, O God, for a Prophet" },
      invocation: null,
      wardBusiness: null,
      sacramentHymn: { number: 193, title: "I Stand All Amazed" },
      specialNotes: null,
      musicalNumber: null,
      speakers: [
        {
          slotNumber: 1,
          kind: "external",
          printedName: "President Mark Andersen",
          publicName: "President Mark Andersen",
          topic: null,
        },
      ],
      closingHymn: null,
      benediction: null,
      announcements: null,
      leadershipContacts: [],
      missionaries: null,
      missing: [],
    };
  }

  // Typed against the generated row type rather than Record<string, unknown>, so a column renamed
  // by a later migration breaks this suite at compile time instead of silently patching nothing.
  async function setProgram(
    patch: Database["public"]["Tables"]["programs"]["Update"],
  ): Promise<void> {
    const { error } = await fixtures.service
      .from("programs")
      .update(patch)
      .eq("id", programId);

    if (error) throw new Error(`Could not set the program: ${error.message}`);
  }

  // The distribute route READS THE STORED FILE BACK rather than re-rendering it, so a fixture that
  // only sets pdf_url describes a state the app treats as broken — and correctly so: a link with
  // no object behind it is a 409 telling the secretary to generate it again. A real object has to
  // exist for the happy paths to be happy.
  const storageKey = () => `${fixtures.wardAId}/${SUNDAY_DATE}.pdf`;

  async function seedStoredPdf(): Promise<void> {
    const { error } = await fixtures.service.storage
      .from("programs")
      .upload(storageKey(), new Uint8Array(Buffer.from("%PDF-1.7 test programme")), {
        contentType: "application/pdf",
        upsert: true,
      });

    if (error) throw new Error(`Could not seed the stored PDF: ${error.message}`);
  }

  async function readProgramRow(): Promise<Record<string, unknown>> {
    const { data, error } = await fixtures.service
      .from("programs")
      .select("status, pdf_url, distributed_at, distributed_by")
      .eq("id", programId)
      .single();

    if (error) throw new Error(`Could not re-read the program: ${error.message}`);
    return data as Record<string, unknown>;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(
      ["bishop", "wardSecretary", "musicCoordinator"],
      {
        notificationTriggers: [
          {
            triggerKey: "program_distributed",
            defaultRoles: ["bishop", "counselor", "ward_secretary"],
          },
        ],
      },
    );

    const { data: sunday, error: sundayError } = await fixtures.service
      .from("sundays")
      .insert({
        ward_id: fixtures.wardAId,
        date: SUNDAY_DATE,
        type: "standard",
        speaking_slots: 1,
        conducting_user_id: fixtures.user("bishop").id,
      })
      .select("id")
      .single();
    if (sundayError) throw new Error(sundayError.message);
    sundayId = sunday.id;

    const { data: program, error: programError } = await fixtures.service
      .from("programs")
      .insert({
        ward_id: fixtures.wardAId,
        sunday_id: sundayId,
        draft_data: draft(SUNDAY_DATE),
        status: "approved",
        created_by: fixtures.user("wardSecretary").id,
      })
      .select("id")
      .single();
    if (programError) throw new Error(programError.message);
    programId = program.id;

    const { error: settingsError } = await fixtures.service
      .from("wards")
      .update({
        settings: {
          program_distribution_list: RECIPIENTS,
          librarian_email: LIBRARIAN,
        },
      })
      .eq("id", fixtures.wardAId);
    if (settingsError) throw new Error(settingsError.message);

    await seedStoredPdf();
  });

  afterAll(async () => {
    // Storage objects are not rows, so fixtures.cleanup() knows nothing about them. Removed here
    // or the shared hosted project accumulates one orphan per run (CLAUDE.md §9).
    await fixtures.service.storage.from("programs").remove([storageKey()]);
    await fixtures.cleanup();
  });

  beforeEach(async () => {
    sendMock.mockReset();
    configurationMock.mockReset();
    configurationMock.mockReturnValue({
      configured: true,
      fromAddress: "programme@buffaloward.test",
    });
    sendMock.mockResolvedValue({ error: null });

    // Every test starts from an approved programme with a PDF, then breaks the one thing it is
    // about. Re-set here rather than in each test so a test that forgets cannot inherit the
    // previous one's damage.
    await setProgram({
      status: "approved",
      pdf_url: "https://example.test/signed/programme.pdf",
      distributed_at: null,
      distributed_by: null,
    });
  });

  describe("POST /api/programs/[id]/generate-pdf", () => {
    // THE ONE THAT PROVES THE WHOLE CHAIN, and the only test anywhere that exercises it end to
    // end: assertCan lets the secretary through, ensureProgramPublicPage creates the public_pages
    // row program-c always needed and nothing ever wrote, migration 040's INSERT policy accepts
    // the upload, and pdf_url comes back a signed URL rather than a storage key.
    //
    // It renders a real PDF, so it is the slowest test in this file. It earns it: every one of
    // those four steps is a place where a passing unit test would still leave a ward unable to
    // print.
    it("renders, stores, and links a PDF for a ward secretary", async () => {
      await actAs(fixtures, "wardSecretary");

      const { status, body } = await callGenerate(programId);

      expect(status).toBe(200);
      expect(body.byteLength).toBeGreaterThan(1000);

      // A SIGNED URL, not a storage key. /public/[slug] renders this value straight into an href,
      // so a bare `{ward_id}/{date}.pdf` would be a broken link on the one page a congregation
      // actually opens.
      const pdfUrl = body.pdfUrl as string;
      expect(pdfUrl.startsWith("https://")).toBe(true);
      expect(pdfUrl).toContain("token=");
      expect((await readProgramRow()).pdf_url).toBe(pdfUrl);

      // The row program-c depended on and nothing created until now.
      const { data: page, error: pageError } = await fixtures.service
        .from("public_pages")
        .select("slug, is_active")
        .eq("ward_id", fixtures.wardAId)
        .eq("page_type", "program")
        .single();
      if (pageError) throw new Error(`No public page row: ${pageError.message}`);
      expect(page.is_active).toBe(true);

      // Written by the upload, readable back with the service client — proof the object exists
      // rather than proof the route said it did.
      const { data: object } = await fixtures.service.storage
        .from("programs")
        .download(storageKey());
      expect(object).not.toBeNull();

      const { data: audit } = await fixtures.service
        .from("audit_log")
        .select("detail")
        .eq("ward_id", fixtures.wardAId)
        .eq("action", "program_pdf_generated")
        .limit(1)
        .single();
      expect((audit?.detail as Record<string, unknown>)?.sundayDate).toBe(SUNDAY_DATE);
    });

    it("refuses a program that has not been approved", async () => {
      await setProgram({ status: "draft" });
      await actAs(fixtures, "wardSecretary");

      const { status, body } = await callGenerate(programId);

      expect(status).toBe(409);
      // The sentence says where the programme actually is and what has to happen first.
      expect(errorMessage(body)).toContain("approved");
    });

    it("refuses a music coordinator", async () => {
      // music_coordinator holds music.* and talks.view, and NOT program.build. Checked against
      // lib/auth/permissions.ts rather than assumed — the matrix is not always the intuitive
      // answer (CLAUDE.md §8).
      await actAs(fixtures, "musicCoordinator");

      const { status } = await callGenerate(programId);

      expect(status).toBe(403);
    });
  });

  describe("POST /api/programs/[id]/distribute", () => {
    it("lets a ward secretary distribute an approved program", async () => {
      await actAs(fixtures, "wardSecretary");

      const { status, body } = await callDistribute(programId);

      expect(status).toBe(200);
      // Three addresses: the two on the list plus the librarian.
      expect(body.sentCount).toBe(3);
      expect(body.failedCount).toBe(0);

      const row = await readProgramRow();
      expect(row.status).toBe("distributed");
      expect(row.distributed_at).not.toBeNull();
      expect(row.distributed_by).toBe(fixtures.user("wardSecretary").id);
    });

    // 06-program-music.md is explicit: never gate this on the secretary role alone. A ward whose
    // secretary is away on the Thursday still has to get its programme out.
    it("lets the bishop distribute too", async () => {
      await actAs(fixtures, "bishop");

      const { status } = await callDistribute(programId);

      expect(status).toBe(200);
    });

    it("refuses a music coordinator", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await callDistribute(programId);

      expect(status).toBe(403);
      // Nothing was sent, and — the part that matters — the programme is untouched. An RLS-denied
      // or route-denied write is a zero-row success, so the refusal is proved by RE-READING.
      expect(sendMock).not.toHaveBeenCalled();
      expect((await readProgramRow()).status).toBe("approved");
    });

    it("refuses a program that is still a draft", async () => {
      await setProgram({ status: "draft" });
      await actAs(fixtures, "wardSecretary");

      const { status, body } = await callDistribute(programId);

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("not approved");
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("refuses a program with no PDF, and says which button is missing", async () => {
      await setProgram({ pdf_url: null });
      await actAs(fixtures, "wardSecretary");

      const { status, body } = await callDistribute(programId);

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("Generate the PDF first");
      expect(sendMock).not.toHaveBeenCalled();
      expect((await readProgramRow()).status).toBe("approved");
    });

    it("refuses when pdf_url points at an object that is not there", async () => {
      // The missing object is produced by MOVING THE KEY, not by deleting the file. The storage
      // key is `{ward_id}/{draft.date}.pdf`, so a draft dated differently from the stored object
      // points at a key that has never existed — deterministic, where a delete-then-read races
      // storage's own consistency and passed a 200 the first time it was tried.
      await setProgram({
        draft_data: draft("2027-09-12") as unknown as Json,
        pdf_url: "https://example.test/signed/gone.pdf",
      });
      await actAs(fixtures, "wardSecretary");

      const { status, body } = await callDistribute(programId);

      // Its own kind and its own sentence. A link with no object behind it used to fall through to
      // the 500 fallback, which told a secretary the server had broken rather than which button to
      // press.
      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("Generate the PDF again");
      expect(sendMock).not.toHaveBeenCalled();
      expect((await readProgramRow()).status).toBe("approved");

      await setProgram({ draft_data: draft(SUNDAY_DATE) as unknown as Json });
    });

    it("refuses a second distribution of the same program", async () => {
      await actAs(fixtures, "wardSecretary");
      expect((await callDistribute(programId)).status).toBe(200);

      const { status, body } = await callDistribute(programId);

      // There is no path out of `distributed` — an email cannot be sent twice or recalled.
      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("already been distributed");
    });

    describe("the recipient-count guard", () => {
      // The number the confirm dialog SHOWED before the button was pressed. If the list moved in
      // between, the person agreed to email a different set of people than the one that would be
      // emailed — and this is the step that cannot be taken back.
      it("refuses when the list changed under the confirm dialog", async () => {
        await actAs(fixtures, "wardSecretary");

        const { status, body } = await callDistribute(programId, {
          expectedRecipientCount: 7,
        });

        expect(status).toBe(409);
        expect(body.recipientCount).toBe(3);
        expect(sendMock).not.toHaveBeenCalled();
        expect((await readProgramRow()).status).toBe("approved");
      });

      it("proceeds when the count still matches", async () => {
        await actAs(fixtures, "wardSecretary");

        const { status } = await callDistribute(programId, { expectedRecipientCount: 3 });

        expect(status).toBe(200);
      });
    });

    describe("when no sending domain is verified", () => {
      beforeEach(() => {
        configurationMock.mockReturnValue({
          configured: false,
          reason: "Email distribution needs a verified sending domain.",
        });
      });

      // The decision recorded in the route's header. Publishing genuinely happens — the public
      // page and the QR code depend on it and nothing else in the app can reach `distributed` —
      // and the response says in plain words that nothing was emailed.
      it("publishes without sending, and says so", async () => {
        await actAs(fixtures, "wardSecretary");

        const { status, body } = await callDistribute(programId);

        expect(status).toBe(200);
        expect(body.emailConfigured).toBe(false);
        expect(body.sentCount).toBe(0);
        expect(body.emailDisabledReason).toContain("verified sending domain");
        expect(sendMock).not.toHaveBeenCalled();
        expect((await readProgramRow()).status).toBe("distributed");
      });
    });

    describe("when every send fails", () => {
      it("does not mark the program distributed", async () => {
        sendMock.mockResolvedValue({
          error: { name: "validation_error", message: "The domain is not verified" },
        });
        await actAs(fixtures, "wardSecretary");

        const { status } = await callDistribute(programId);

        expect(status).toBe(502);
        // The whole reason total failure throws rather than returning zero: `distributed` is
        // permanent, and a programme nobody received must stay sendable.
        expect((await readProgramRow()).status).toBe("approved");
      });
    });

    describe("partial failure", () => {
      it("reports both counts and still distributes", async () => {
        sendMock
          .mockResolvedValueOnce({ error: null })
          .mockResolvedValueOnce({
            error: { name: "validation_error", message: "Invalid `to`" },
          })
          .mockResolvedValueOnce({ error: null });
        await actAs(fixtures, "wardSecretary");

        const { status, body } = await callDistribute(programId);

        expect(status).toBe(200);
        expect(body.sentCount).toBe(2);
        expect(body.failedCount).toBe(1);
        // Some people have the email. That cannot be undone, so the programme has genuinely gone.
        expect((await readProgramRow()).status).toBe("distributed");
      });
    });

    describe("the audit row", () => {
      it("carries a recipient count and no email address", async () => {
        await actAs(fixtures, "wardSecretary");
        await callDistribute(programId);

        const { data, error } = await fixtures.service
          .from("audit_log")
          .select("detail")
          .eq("ward_id", fixtures.wardAId)
          .eq("action", "program_distributed")
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (error) throw new Error(`Could not read the audit row: ${error.message}`);

        const detail = data.detail as Record<string, unknown>;
        expect(detail.recipientCount).toBe(3);

        // SCANNED FOR WHAT MUST NOT BE THERE, not checked field by field — the shape
        // tests/lib/publicProjection.test.ts uses, and for the same reason: a field added later
        // that carries an address fails this WITHOUT anybody updating the assertion. The audit log
        // is readable by anyone holding audit.view.
        const serialised = JSON.stringify(detail);
        for (const address of [...RECIPIENTS, LIBRARIAN]) {
          expect(serialised).not.toContain(address);
        }
        expect(serialised).not.toContain("@");
      });
    });
  });
});
