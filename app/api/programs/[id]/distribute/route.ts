import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { emailConfiguration } from "@/lib/email/resend";
import { emitNotification } from "@/lib/notifications/emitNotification";
import {
  DistributionError,
  isDistributionError,
  readDistributionRecipients,
  sendProgramEmails,
} from "@/lib/program/distribution";
import { readProgramRenderSettings } from "@/lib/program/gather";
import {
  ensureProgramPublicPage,
  getProgram,
  programPublicUrl,
  recordProgramDistribution,
} from "@/lib/program/queries";
import { readProgramPdf } from "@/lib/program/storage";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { distributeProgramSchema, programIdSchema } from "@/lib/validation/program";
import { PROGRAM_STATUS_LABELS } from "@/types/domain";

// Email the PDF, and mark the programme distributed.
//
// ---------------------------------------------------------------------------------------------
// THIS IS THE ONE STEP IN THE APP THAT CANNOT BE UNDONE
// ---------------------------------------------------------------------------------------------
// LEGAL_TRANSITIONS gives `distributed` no way out, because an email that has gone cannot be
// recalled. Everything below is shaped by that: an expected-status guard so a double-click cannot
// send twice, a recipient-count check so the list cannot change under the confirm dialog, and a
// total-failure path that refuses to mark the programme distributed when nothing left the building.
//
// ---------------------------------------------------------------------------------------------
// DISTRIBUTION IS ALSO PUBLICATION
// ---------------------------------------------------------------------------------------------
// migration 039's view requires `status = 'distributed'`, so this is the moment /public/[slug]
// stops being dark. revalidatePath below is what makes that immediate rather than five minutes
// later, on the Sunday morning when somebody is actually pointing a phone at the QR code.
//
// ---------------------------------------------------------------------------------------------
// EMAIL IS OFF UNTIL A DOMAIN IS VERIFIED — AND THE PROGRAMME STILL PUBLISHES
// ---------------------------------------------------------------------------------------------
// Resend's test sender only delivers to the account owner (the `deployment` retro), so with no
// RESEND_FROM_ADDRESS configured this route DOES NOT SEND and does not pretend to. It still
// publishes: the status moves, the public page lights up, the QR code works, and the response says
// in plain words that nothing was emailed and the PDF must be sent by hand.
//
// That is a deliberate reading of "ship distribution disabled with an honest message". Refusing
// the whole route would leave program-c's public page permanently unreachable — nothing else in
// the app can move a programme to `distributed` — so the printed programme and the QR would both
// be dead on arrival. The dishonest outcome this avoids is claiming an email was sent; publishing
// is genuinely happening and is genuinely reported.

const NOT_FOUND = "That program is not in your ward.";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const { id } = await params;
    const programId = programIdSchema.parse(id);
    const input = distributeProgramSchema.parse(await readJsonBody(request));

    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    // Held by ward_secretary AND the bishopric. 06-program-music.md is explicit that this must
    // never be gated on the secretary alone — a ward whose secretary is away on the Thursday
    // still has to get its programme out.
    assertCan(user, "program.distribute", roleAccess);

    const program = await getProgram(user.wardId, programId, supabase);
    if (!program) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    if (program.status !== "approved") {
      return NextResponse.json(
        {
          error:
            program.status === "distributed"
              ? "That program has already been distributed. An email cannot be sent twice or recalled."
              : `That program is ${PROGRAM_STATUS_LABELS[program.status].toLowerCase()}, not approved. The bishopric approves it before it can go out.`,
        },
        { status: 409 },
      );
    }

    // Its own sentence, distinct from "not approved". A secretary who approved the programme and
    // forgot to press Generate needs to be told which button they are missing.
    if (program.pdfUrl === null) {
      return NextResponse.json(
        {
          error:
            "That program has no PDF yet. Generate the PDF first — that is the file people receive.",
        },
        { status: 409 },
      );
    }

    if (program.draft === null) {
      return NextResponse.json(
        {
          error:
            program.draftError ??
            "That program has no stored draft, so there is nothing to send. Build it again first.",
        },
        { status: 409 },
      );
    }

    const draft = program.draft;
    const recipients = await readDistributionRecipients(user.wardId, supabase);
    const configuration = emailConfiguration();

    // Checked BEFORE the count guard and before reading the PDF back. When email is switched off
    // the recipient list is not a precondition for anything, and refusing a publish because a
    // list nobody can email is empty would be a nonsense.
    if (configuration.configured) {
      if (recipients.addresses.length === 0) {
        throw new DistributionError(
          "no_recipients",
          recipients.invalid.length > 0
            ? `None of the ${recipients.invalid.length} entries on the programme distribution list are valid email addresses. Fix them in ward settings — nothing was sent.`
            : "Nobody is on the programme distribution list yet. Add at least one email address in ward settings before sending.",
        );
      }

      // The list changed between the confirm dialog being drawn and the button being pressed.
      // Refused rather than sent, because the person agreed to email a specific number of people
      // and this is the step that cannot be taken back.
      if (
        input.expectedRecipientCount !== undefined &&
        input.expectedRecipientCount !== recipients.addresses.length
      ) {
        return NextResponse.json(
          {
            error: `The distribution list changed while you were looking at it — it now has ${recipients.addresses.length} ${recipients.addresses.length === 1 ? "address" : "addresses"}, not ${input.expectedRecipientCount}. Nothing was sent. Reload and check the list.`,
            recipientCount: recipients.addresses.length,
          },
          { status: 409 },
        );
      }
    }

    const { wardName } = await readProgramRenderSettings(user.wardId, supabase);
    const slug = await ensureProgramPublicPage(user.wardId, supabase);
    const publicUrl = programPublicUrl(slug);

    let sentCount = 0;
    let failedCount = 0;
    let failures: { address: string; reason: string }[] = [];

    if (configuration.configured) {
      // Re-read rather than re-rendered, so the PDF a ward is emailed is BYTE-IDENTICAL to the one
      // they proofread and to the one behind the public link.
      //
      // `pdf_url` being set is NOT proof the object is still there — a bucket cleared by hand, a
      // ward id that moved, a generation that stored the link and lost the file. Translated into
      // its own kind so the secretary is told to generate it again rather than reading a 500 that
      // says the server broke.
      let pdf: Buffer;
      try {
        pdf = await readProgramPdf(user.wardId, draft.date, supabase);
      } catch (error) {
        throw new DistributionError(
          "pdf_missing",
          "This program's PDF could not be found in storage, so there was nothing to attach. Generate the PDF again, then send it.",
          error,
        );
      }

      const outcome = await sendProgramEmails({
        recipients: recipients.addresses,
        wardName,
        sundayDate: draft.date,
        pdf,
        publicUrl,
      });

      // A TOTAL failure throws out of sendProgramEmails and never reaches here, so the programme
      // is not marked distributed when nothing was sent. A PARTIAL failure does reach here: some
      // people have the email, that cannot be undone, and the programme genuinely has gone out.
      sentCount = outcome.sentCount;
      failedCount = outcome.failedCount;
      failures = outcome.failures;
    }

    const distributed = await recordProgramDistribution(
      user.wardId,
      programId,
      user.id,
      supabase,
    );

    // Zero rows means somebody else distributed it between the read and the write. If email was
    // configured, some of it has already gone — which is exactly why the expected-status filter is
    // in the UPDATE rather than a read-then-compare.
    if (!distributed) {
      return NextResponse.json(
        {
          error:
            "Somebody else distributed this program a moment ago. Reload to see where it is now.",
        },
        { status: 409 },
      );
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "program_distributed",
        module: "program",
        detail: {
          programId,
          sundayDate: draft.date,
          // A COUNT, NEVER THE ADDRESSES. The audit log is readable by anyone holding audit.view,
          // and a ward's leadership email addresses are not something a distribution receipt needs
          // to carry. `failures` above holds them for the screen the sender is looking at, and
          // goes no further.
          recipientCount: sentCount,
          failedCount,
          emailConfigured: configuration.configured,
        },
      },
      supabase,
    );

    await emitNotification({
      wardId: user.wardId,
      triggerKey: "program_distributed",
      title: "The sacrament program has gone out",
      body: configuration.configured
        ? `The program for ${draft.date} was emailed to ${sentCount} ${sentCount === 1 ? "person" : "people"} and is now on the public page.`
        : `The program for ${draft.date} is now on the public page. It was not emailed — email distribution is not set up yet.`,
    });

    // program-c's page is statically cached. Without this the QR code would serve a stale "no
    // program yet" page for up to five minutes after distribution, which is the one window in
    // which somebody is actually scanning it.
    //
    // CAUGHT, AND DELIBERATELY NOT ALLOWED TO FAIL THE REQUEST. Everything above it has already
    // happened and none of it can be undone: the emails have gone, the status has moved, the audit
    // row is written. A throw here would fall through to the catch below and answer 500 with
    // "nothing was marked as sent" — which would be false, and would invite the secretary to press
    // the button again. A stale cache for five minutes is a far smaller problem than that.
    //
    // It throws outside a request scope (route tests call the handler as a plain function), and it
    // could throw in production for reasons that have nothing to do with this programme.
    try {
      revalidatePath(`/public/${slug}`);
    } catch (error) {
      console.error(
        `Distributed a program but could not revalidate its public page — ${error instanceof Error ? error.message : String(error)}`,
        { wardId: user.wardId, programId, slug },
      );
    }

    return NextResponse.json({
      program: distributed,
      emailConfigured: configuration.configured,
      // Non-null only when email is switched off, and it carries the reason a person can act on.
      emailDisabledReason: configuration.configured ? null : configuration.reason,
      sentCount,
      failedCount,
      failures,
      invalidRecipients: recipients.invalid,
      publicUrl,
    });
  } catch (error) {
    // The six distribution kinds keep their own sentences and their own statuses. Folding them
    // into the 500 fallback would collapse "add an address", "verify a domain" and "the vendor
    // refused" into one message that tells a secretary nothing (`ai-a`).
    if (isDistributionError(error)) {
      console.error(`Distribution failed — ${error.kind}`, {
        wardId: user.wardId,
        userId: user.id,
        cause: error.cause,
      });
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return respondToRouteError(error, {
      route: "POST /api/programs/[id]/distribute",
      fallbackMessage:
        "Could not distribute the program. The cause has been logged — nothing was marked as sent.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
