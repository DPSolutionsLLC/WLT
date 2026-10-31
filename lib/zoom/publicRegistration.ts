import { z } from "zod";
import { createAnonSupabaseClient } from "@/lib/supabase/anon";
import {
  ZOOM_REGISTRATION_QUESTION_AUDIENCES,
  ZOOM_REGISTRATION_QUESTION_KINDS,
  ZOOM_REGISTRATION_STATUSES,
} from "@/types/domain";

// Every read behind the public Zoom sign-up pages (ITER-052, plan P5). NOTHING under app/public/
// touches Supabase directly.
//
// ANON, AND ONLY ANON — lib/program/publicQueries.ts's rule. This module accepts no client
// argument: there is one correct client for a public page, and a service-role client reaching
// here would read straight past every restriction the two functions exist to impose.
//
// anon holds no grant on any of migration 096's tables. It may only execute
// zoom_registration_form() and zoom_registration_status(), security definer functions returning
// narrow shapes: the ward's name and its questions; and one registrant's own name, status and link.
//
// AN RPC ERROR THROWS (a 500 in a log); "no row" returns null (a 404). A dropped grant must never
// look exactly like a slug nobody created (program-c).

const formQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  kind: z.enum(ZOOM_REGISTRATION_QUESTION_KINDS),
  audience: z.enum(ZOOM_REGISTRATION_QUESTION_AUDIENCES),
  is_required: z.boolean(),
  shown_when_yes_to: z.string().nullable(),
});

export type PublicRegistrationQuestion = {
  id: string;
  prompt: string;
  kind: (typeof ZOOM_REGISTRATION_QUESTION_KINDS)[number];
  audience: (typeof ZOOM_REGISTRATION_QUESTION_AUDIENCES)[number];
  isRequired: boolean;
  shownWhenYesTo: string | null;
};

export type PublicRegistrationForm = {
  wardName: string;
  isOpen: boolean;
  questions: PublicRegistrationQuestion[];
};

export async function getRegistrationForm(slug: string): Promise<PublicRegistrationForm | null> {
  const supabase = createAnonSupabaseClient();
  const { data, error } = await supabase.rpc("zoom_registration_form", { p_slug: slug });

  if (error) {
    console.error(`Could not read a Zoom sign-up page — ${error.message}`, { slug });
    throw new Error(`Could not read that public page: ${error.message}`);
  }

  const row = (data ?? [])[0];
  if (!row) return null;

  // Parsed, never cast. A question list this page cannot read means the page goes dark rather than
  // asking half the questions.
  const questions = z.array(formQuestionSchema).safeParse(row.questions);
  if (!questions.success) {
    console.error("A Zoom sign-up page's questions could not be read", {
      slug,
      issue: questions.error.issues[0]?.message,
    });
    return null;
  }

  return {
    wardName: row.ward_name,
    isOpen: row.is_open,
    questions: questions.data.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      kind: question.kind,
      audience: question.audience,
      isRequired: question.is_required,
      shownWhenYesTo: question.shown_when_yes_to,
    })),
  };
}

const statusSchema = z.enum(ZOOM_REGISTRATION_STATUSES);

export type PublicRegistrationStatus = {
  slug: string;
  wardName: string;
  displayName: string;
  status: (typeof ZOOM_REGISTRATION_STATUSES)[number];
  linkGiven: boolean;
  joinUrl: string | null;
  referralCode: string;
};

// The token is never logged — not even on an error.
export async function getRegistrationStatus(token: string): Promise<PublicRegistrationStatus | null> {
  const supabase = createAnonSupabaseClient();
  const { data, error } = await supabase.rpc("zoom_registration_status", { p_token: token });

  if (error) {
    console.error(`Could not read a Zoom sign-up status page — ${error.message}`);
    throw new Error(`Could not read that public page: ${error.message}`);
  }

  const row = (data ?? [])[0];
  if (!row) return null;

  const status = statusSchema.safeParse(row.status);
  // No active sign-up page any more (it was switched off for good) is a page that does not exist.
  if (!status.success || !row.slug) return null;

  return {
    slug: row.slug,
    wardName: row.ward_name,
    displayName: row.display_name,
    status: status.data,
    linkGiven: row.link_given,
    joinUrl: row.join_url ?? null,
    referralCode: row.referral_code,
  };
}
