import type { DateOnly } from "@/lib/calendar/dates";
import {
  publicProgramSchema,
  type PublicProgram,
} from "@/lib/program/publicProjection";
import { createAnonSupabaseClient } from "@/lib/supabase/anon";

// Every read behind /public/[slug]. NOTHING under app/public/ touches Supabase directly.
//
// ---------------------------------------------------------------------------------------------
// ANON, AND ONLY ANON
// ---------------------------------------------------------------------------------------------
// This module deliberately does not accept a client argument, unlike lib/program/queries.ts. There
// is one correct client for a public page and passing a different one is not a use case — a
// service-role client reaching this code path would read straight past every restriction the two
// views exist to impose.
//
// anon holds a grant on exactly two objects (migrations 019 and 039): public_program and
// public_sacrament_assignments. It has no grant on `programs`, `members`, `sundays`, `wards` or
// `public_pages`, so the queries below cannot be widened by accident into something that reads a
// base table — the widened query simply fails.
//
// ---------------------------------------------------------------------------------------------
// HOW THE PAGE TYPE IS RESOLVED WITHOUT READING public_pages
// ---------------------------------------------------------------------------------------------
// `page_type` lives on public_pages, which anon cannot read. It does not need to: each view
// already filters on its own page_type, so WHICH VIEW ANSWERS is the page type. A slug that the
// program view answers for is a program page; one only the assignments view knows is Phase 10's.
// Exposing public_pages to anon just to read a discriminator would add a third public object to
// keep safe, and it would list every slug in every ward.

export type PublicProgramPage = {
  slug: string;
  wardName: string;
  sundayDate: DateOnly;
  program: PublicProgram;
  pdfUrl: string | null;
  distributedAt: string | null;
};

// Column lists are written out, never `*`. The views name their own columns too, so this is the
// second of two explicit lists — belt and braces on the one surface where a surprise column is a
// privacy incident rather than an inconvenience.
const PROGRAM_COLUMNS = "slug, sunday_date, ward_name, public_data, pdf_url, distributed_at";

// THE MOST CURRENT PROGRAM, WHICH IS THE LATEST SUNDAY THAT HAS ONE.
//
// A SLUG IDENTIFIES A WARD'S PROGRAM PAGE, NOT A PROGRAM. The view joins public_pages to programs
// on ward_id alone (migration 019, kept by 039), so an active slug matches EVERY distributed
// program that ward has ever had — two rows after two Sundays, fifty after a year. The `.limit(1)`
// below is therefore load-bearing, not a tidy-up: without the ordering it would return an
// arbitrary Sunday, and a congregation would read last March's program off a QR code.
//
// FEATURES.md says the public page "always reflects the most current approved version"; ordering
// by sunday_date descending is what that means in practice. Next Sunday's program becomes the
// answer the moment it is distributed on Thursday, and it stays the answer through the meeting it
// was printed for.
//
// Ordering by distributed_at instead would let a re-distributed OLD program jump to the front of a
// congregation's phone on a Sunday morning, which is the one moment this page is actually used.
export async function getPublicProgram(slug: string): Promise<PublicProgramPage | null> {
  const supabase = createAnonSupabaseClient();

  const { data, error } = await supabase
    .from("public_program")
    .select(PROGRAM_COLUMNS)
    .eq("slug", slug)
    .order("sunday_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Logged with the slug and surfaced by throwing (CLAUDE.md rule 7). A read failure is NOT
    // turned into a 404: "this page does not exist" and "the database refused" are different
    // facts, and quietly reporting the first would hide a dropped grant — the exact failure that
    // recreating this view can cause, with nothing in any log to say why.
    console.error(`Could not read the public program view — ${error.message}`, { slug });
    throw new Error(`Could not read that public page: ${error.message}`);
  }

  if (!data) return null;

  // Parsed, never cast. public_data is jsonb, and a projection this page cannot read is a page
  // that must go dark rather than render half a program with holes in it.
  const parsed = publicProgramSchema.safeParse(data.public_data);
  if (!parsed.success) {
    console.error("A stored public projection could not be read", {
      slug,
      issue: parsed.error.issues[0]?.message,
    });
    return null;
  }

  // Built field by field. The view's row type is not spread into the page's props: a column added
  // to the view later must be added here on purpose before anything can render it.
  return {
    slug: data.slug ?? slug,
    wardName: data.ward_name ?? "",
    sundayDate: parsed.data.date,
    program: parsed.data,
    pdfUrl: data.pdf_url,
    distributedAt: data.distributed_at,
  };
}

// Existence only, and it reads ONE column to establish it. Selecting `*` here would pull member
// first names and last initials into a process that has no use for them, which is not a leak but
// is the habit that becomes one.
//
// Phase 10 replaces this with a real read (05 → plans/10-sacrament-admin.md).
export async function hasPublicAssignmentsPage(slug: string): Promise<boolean> {
  const supabase = createAnonSupabaseClient();

  const { data, error } = await supabase
    .from("public_sacrament_assignments")
    .select("slug")
    .eq("slug", slug)
    .limit(1);

  if (error) {
    console.error(
      `Could not read the public assignments view — ${error.message}`,
      { slug },
    );
    throw new Error(`Could not read that public page: ${error.message}`);
  }

  return (data ?? []).length > 0;
}
