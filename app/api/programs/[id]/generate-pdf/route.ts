import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { readProgramRenderSettings } from "@/lib/program/gather";
import { renderProgramPdf } from "@/lib/pdf/renderProgram";
import { programQrDataUri } from "@/lib/pdf/qrCode";
import {
  ensureProgramPublicPage,
  getProgram,
  programPublicUrl,
  setProgramPdfUrl,
} from "@/lib/program/queries";
import { storeProgramPdf } from "@/lib/program/storage";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { programIdSchema } from "@/lib/validation/program";
import { PROGRAM_STATUS_LABELS } from "@/types/domain";

// Render the bifold PDF and store it.
//
// ---------------------------------------------------------------------------------------------
// APPROVED OR DISTRIBUTED ONLY
// ---------------------------------------------------------------------------------------------
// Rendering a `draft` would produce a printable PDF of a document nobody has signed off, and a
// printed programme is exactly the artefact somebody would then hand to a librarian. The phase
// plan's "generate on approval" is enforced here as a guard rather than left as a convention.
//
// `distributed` is allowed as well as `approved` because a ward may need another copy of a
// programme it has already sent — the render is deterministic from the stored snapshot, so it
// produces the same document. It does NOT re-send anything.
//
// ---------------------------------------------------------------------------------------------
// THIS IS ALSO WHERE THE PUBLIC PAGE FINALLY GETS A SLUG
// ---------------------------------------------------------------------------------------------
// program-c built /public/[slug], the projection and the view, and nothing anywhere created the
// public_pages row they all depend on. The QR code needs that URL, so this route creates it —
// which is what makes program-c's page reachable for the first time.
//
// ---------------------------------------------------------------------------------------------
// NO REQUEST BODY IS READ
// ---------------------------------------------------------------------------------------------
// Everything this route needs is already stored. There is deliberately no readJsonBody() call:
// a body would be a second source of truth for a document the bishopric has already approved,
// and an empty POST would fail JSON parsing for no reason.

const NOT_FOUND = "That program is not in your ward.";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const { id } = await params;
    const programId = programIdSchema.parse(id);

    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    // program.build, not program.approve. The ward secretary builds the programme all week and
    // generates its PDF; the bishopric signs it off. Gating this on approve would put the
    // secretary in the position of needing a counselor to press a button for them.
    assertCan(user, "program.build", roleAccess);

    const program = await getProgram(user.wardId, programId, supabase);
    if (!program) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    if (program.status !== "approved" && program.status !== "distributed") {
      // The sentence says where the programme ACTUALLY is and what to do about it, rather than
      // only that the request was refused (the approve route's rule).
      return NextResponse.json(
        {
          error: `That program is ${PROGRAM_STATUS_LABELS[program.status].toLowerCase()}. A PDF is only generated once the bishopric has approved it.`,
        },
        { status: 409 },
      );
    }

    // draftError is surfaced rather than swallowed (CLAUDE.md rule 7). A stored draft that no
    // longer parses cannot be rendered, and failing inside the renderer would produce a stack
    // trace instead of a sentence.
    if (program.draft === null) {
      return NextResponse.json(
        {
          error:
            program.draftError ??
            "That program has no stored draft, so there is nothing to print. Build it again first.",
        },
        { status: 409 },
      );
    }

    const draft = program.draft;
    const { settings, wardName } = await readProgramRenderSettings(user.wardId, supabase);

    // The slug row is created on first use. The URL may still be null when no site URL is
    // configured — see resolveSiteUrl(), which refuses to guess at localhost rather than printing
    // a QR code that scans to a developer's laptop.
    const slug = await ensureProgramPublicPage(user.wardId, supabase);
    const publicUrl = programPublicUrl(slug);

    const warnings: string[] = [];
    let qrDataUri: string | null = null;

    if (publicUrl === null) {
      warnings.push(
        "The programme was printed without a QR code because no public site address is configured. Set NEXT_PUBLIC_SITE_URL and generate it again.",
      );
    } else {
      try {
        qrDataUri = await programQrDataUri(publicUrl);
      } catch (error) {
        // A QR failure does NOT fail the programme. The meeting order is the point of the
        // document; the code is a convenience. Logged with its cause, reported as a sentence.
        console.error(
          `Could not build a programme QR code — ${error instanceof Error ? error.message : String(error)}`,
          { wardId: user.wardId, programId },
        );
        warnings.push(
          "The programme was printed without a QR code because the code could not be generated. The web address is still printed on the back panel.",
        );
      }
    }

    const rendered = await renderProgramPdf({
      draft,
      template: settings.template,
      fallbackWardName: wardName,
      qrDataUri,
      publicUrl,
    });

    warnings.push(...rendered.warnings);

    const stored = await storeProgramPdf(
      user.wardId,
      draft.date,
      rendered.buffer,
      supabase,
    );

    const updated = await setProgramPdfUrl(
      user.wardId,
      programId,
      stored.signedUrl,
      supabase,
    );

    // Zero rows means the programme moved out from under this render — somebody reopened it as a
    // draft while the PDF was being built. The file is stored and harmless; what must not happen
    // is pdf_url pointing at a PDF of a programme that is no longer approved.
    if (!updated) {
      return NextResponse.json(
        {
          error:
            "This program changed while the PDF was being built. Reload to see where it is now, then generate it again.",
        },
        { status: 409 },
      );
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "program_pdf_generated",
        module: "program",
        detail: {
          programId,
          sundayDate: draft.date,
          byteLength: stored.byteLength,
          // Recorded so a ward asking "why is there no QR on our programme?" has an answer in the
          // log rather than only in a toast somebody dismissed.
          warningCount: warnings.length,
        },
      },
      supabase,
    );

    return NextResponse.json({
      program: updated,
      pdfUrl: stored.signedUrl,
      publicUrl,
      byteLength: stored.byteLength,
      warnings,
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/programs/[id]/generate-pdf",
      fallbackMessage:
        "Could not generate the PDF. The cause has been logged — try again, and tell an administrator if it keeps happening.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
