import { notFound } from "next/navigation";
import { ProgramPanel } from "./ProgramPanel";
import { getPublicProgram, hasPublicAssignmentsPage } from "@/lib/program/publicQueries";

// /public/[slug] — the application's only unauthenticated page, and the shell both public pages
// share. This plan builds the program branch; phase 10 fills in the assignments one.
//
// ---------------------------------------------------------------------------------------------
// ONE OUTCOME FOR EVERY WAY OF NOT EXISTING
// ---------------------------------------------------------------------------------------------
// An unknown slug, a deactivated slug, a program that has not been distributed, and a program
// whose stored projection cannot be parsed ALL reach notFound(). They are different facts and the
// page tells a visitor none of them: a response that distinguished them would let somebody with a
// word list work out which slugs exist and which wards have a program waiting to go out.
//
// The single code path is the enforcement. Each of those conditions is already folded into the
// view's WHERE clause (migration 039), so there is nothing here to get wrong per-case.
//
// A DATABASE ERROR IS NOT ONE OF THEM. lib/program/publicQueries.ts throws rather than returning
// null on a failed read, so a dropped grant surfaces as a 500 in a log rather than as a 404 that
// looks exactly like a slug nobody has created (CLAUDE.md rule 7).
//
// ---------------------------------------------------------------------------------------------
// CACHING
// ---------------------------------------------------------------------------------------------
// Five minutes. Long enough that a congregation arriving at once is served from cache; short
// enough that a correction made on Sunday morning is not stuck until the meeting is over.
// program-d's distribute route calls revalidatePath() so a genuine change appears immediately
// rather than up to five minutes later.
//
// There is deliberately NO generateStaticParams. Pre-rendering every ward's slug at build time
// would bake ward data into the deployment, and a slug created after a build would be a 404 until
// the next one.
export const revalidate = 300;

export default async function PublicSlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const page = await getPublicProgram(slug);
  if (page) {
    return <ProgramPanel page={page} />;
  }

  // Phase 10's branch. Written now rather than left out, because an active assignments slug is a
  // page somebody was given a link to — telling them it is not ready yet is a different and more
  // honest answer than telling them it does not exist.
  if (await hasPublicAssignmentsPage(slug)) {
    return <NotAvailableYet />;
  }

  notFound();
}

function NotAvailableYet() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-lg font-semibold text-foreground">Not available yet</h1>
      <p className="text-sm text-muted">
        This page is not ready. Please check back later.
      </p>
    </main>
  );
}
