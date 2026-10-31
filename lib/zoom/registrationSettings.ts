import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import type { RegistrationSettingsInput } from "@/lib/validation/zoomRegistration";
import type { Database } from "@/types/database";

// THE WARD'S ZOOM SIGN-UP SETTINGS AND ITS PUBLIC SLUG (ITER-052, migration 096b).
//
// Read through the CALLER's client, where migration 096's policy admits the bishopric, the clerk
// and the executive secretary. The slug lives on `public_pages`, which every signed-in member of
// the ward may read (migration 019's ward policy), so it is read the same way.
//
// Every write is the service role behind canManageInvitees() in the route — the table has no write
// policy — and every service-role call filters `ward_id` (rule 1).

type Client = SupabaseClient<Database>;

export const ZOOM_REGISTRATION_PAGE_TYPE = "zoom_registration";

export const DEFAULT_MISSIONARY_QUESTION = {
  prompt: "Would you welcome a visit from the missionaries?",
  kind: "yes_no",
  audience: "non_members",
  is_required: false,
} as const;

// Asked only of somebody who says Yes to the missionaries (migration 097): an address is needed for
// a visit and for nothing else, so nobody else is asked for one.
export const DEFAULT_ADDRESS_FOLLOW_UP = {
  prompt: "What's your address?",
  kind: "short_text",
  audience: "non_members",
  is_required: true,
} as const;

export type RegistrationSettings = {
  isOpen: boolean;
  autoApprove: boolean;
  emailBishopricOnNew: boolean;
  slug: string;
  updatedAt: string;
};

type SettingsRow = {
  is_open: boolean;
  auto_approve: boolean;
  email_bishopric_on_new: boolean;
  updated_at: string;
};

const SETTINGS_COLUMNS = "is_open, auto_approve, email_bishopric_on_new, updated_at";

function toSettings(row: SettingsRow, slug: string): RegistrationSettings {
  return {
    isOpen: row.is_open,
    autoApprove: row.auto_approve,
    emailBishopricOnNew: row.email_bishopric_on_new,
    slug,
    updatedAt: row.updated_at,
  };
}

async function readActiveSlug(wardId: string, supabase: Client): Promise<string | null> {
  const { data, error } = await supabase
    .from("public_pages")
    .select("slug")
    .eq("ward_id", wardId)
    .eq("page_type", ZOOM_REGISTRATION_PAGE_TYPE)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the Zoom sign-up page's link — ${error.message}`, { wardId });
    throw new Error(`Could not read the sign-up page's link: ${error.message}`);
  }

  return data?.slug ?? null;
}

// Null until somebody presses Set up sign-ups.
export async function readRegistrationSettings(
  wardId: string,
  supabase: Client,
): Promise<RegistrationSettings | null> {
  const { data, error } = await supabase
    .from("zoom_registration_settings")
    .select(SETTINGS_COLUMNS)
    .eq("ward_id", wardId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the Zoom sign-up settings — ${error.message}`, { wardId });
    throw new Error(`Could not read the sign-up settings: ${error.message}`);
  }
  if (!data) return null;

  const slug = await readActiveSlug(wardId, supabase);
  if (slug === null) return null;
  return toSettings(data, slug);
}

function generateRegistrationSlug(): string {
  return `zoom-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

async function ensureSlug(wardId: string, service: Client): Promise<string> {
  const existing = await readActiveSlug(wardId, service);
  if (existing) return existing;

  const { data, error } = await service
    .from("public_pages")
    .insert({
      ward_id: wardId,
      page_type: ZOOM_REGISTRATION_PAGE_TYPE,
      slug: generateRegistrationSlug(),
      is_active: true,
    })
    .select("slug")
    .single();

  if (error) {
    console.error(`Could not create the Zoom sign-up page — ${error.message}`, { wardId });
    throw new Error(`Could not create the sign-up page: ${error.message}`);
  }
  return data.slug;
}

async function ensureDefaultQuestion(
  params: { wardId: string; actorUserId: string },
  service: Client,
): Promise<string | null> {
  const { count, error } = await service
    .from("zoom_registration_questions")
    .select("id", { count: "exact", head: true })
    .eq("ward_id", params.wardId);

  if (error) {
    console.error(`Could not count the Zoom sign-up questions — ${error.message}`, params);
    throw new Error(`Could not read the sign-up questions: ${error.message}`);
  }
  if ((count ?? 0) > 0) return null;

  const { data, error: insertError } = await service
    .from("zoom_registration_questions")
    .insert({
      ward_id: params.wardId,
      ...DEFAULT_MISSIONARY_QUESTION,
      position: 1,
      created_by: params.actorUserId,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error(`Could not add the default Zoom sign-up question — ${insertError.message}`, params);
    throw new Error(`Could not add the default question: ${insertError.message}`);
  }

  const { error: followUpError } = await service.from("zoom_registration_questions").insert({
    ward_id: params.wardId,
    ...DEFAULT_ADDRESS_FOLLOW_UP,
    shown_when_yes_to: data.id,
    position: 2,
    created_by: params.actorUserId,
  });

  if (followUpError) {
    console.error(`Could not add the default address follow-up — ${followUpError.message}`, params);
    throw new Error(`Could not add the address question: ${followUpError.message}`);
  }
  return data.id;
}

export type SetUpResult = {
  settings: RegistrationSettings;
  created: boolean;
  defaultQuestionId: string | null;
};

// Idempotent: a second press finds everything already there and changes nothing. Sign-ups start
// CLOSED, so setting up never publishes a page before somebody has looked at it.
export async function setUpRegistration(
  params: { wardId: string; actorUserId: string },
  service: Client,
): Promise<SetUpResult> {
  const { wardId, actorUserId } = params;

  const { data: inserted, error } = await service
    .from("zoom_registration_settings")
    .upsert(
      { ward_id: wardId, updated_by: actorUserId },
      { onConflict: "ward_id", ignoreDuplicates: true },
    )
    .select("ward_id");

  if (error) {
    console.error(`Could not set up Zoom sign-ups — ${error.message}`, { wardId });
    throw new Error(`Could not set up sign-ups: ${error.message}`);
  }

  await ensureSlug(wardId, service);
  const defaultQuestionId = await ensureDefaultQuestion({ wardId, actorUserId }, service);

  const settings = await readRegistrationSettings(wardId, service);
  if (!settings) throw new Error("Sign-ups were set up but could not be read back.");

  return { settings, created: (inserted ?? []).length > 0, defaultQuestionId };
}

export const REGISTRATION_SETTING_FIELDS = ["isOpen", "autoApprove", "emailBishopricOnNew"] as const;
export type RegistrationSettingField = (typeof REGISTRATION_SETTING_FIELDS)[number];

export function changedSettingFields(
  current: Pick<RegistrationSettings, RegistrationSettingField>,
  input: RegistrationSettingsInput,
): RegistrationSettingField[] {
  return REGISTRATION_SETTING_FIELDS.filter(
    (field) => input[field] !== undefined && input[field] !== current[field],
  );
}

export type UpdateSettingsResult = {
  settings: RegistrationSettings;
  changedFields: RegistrationSettingField[];
} | null;

// Null when sign-ups have not been set up yet.
export async function updateRegistrationSettings(
  params: { wardId: string; actorUserId: string; input: RegistrationSettingsInput },
  service: Client,
): Promise<UpdateSettingsResult> {
  const { wardId, actorUserId, input } = params;
  const current = await readRegistrationSettings(wardId, service);
  if (!current) return null;

  const changedFields = changedSettingFields(current, input);
  if (changedFields.length === 0) return { settings: current, changedFields };

  const patch: Database["public"]["Tables"]["zoom_registration_settings"]["Update"] = {
    updated_by: actorUserId,
    updated_at: new Date().toISOString(),
  };
  if (input.isOpen !== undefined) patch.is_open = input.isOpen;
  if (input.autoApprove !== undefined) patch.auto_approve = input.autoApprove;
  if (input.emailBishopricOnNew !== undefined) patch.email_bishopric_on_new = input.emailBishopricOnNew;

  const { error } = await service
    .from("zoom_registration_settings")
    .update(patch)
    .eq("ward_id", wardId);

  if (error) {
    console.error(`Could not save the Zoom sign-up settings — ${error.message}`, { wardId });
    throw new Error(`Could not save the settings: ${error.message}`);
  }

  const settings = await readRegistrationSettings(wardId, service);
  if (!settings) return null;
  return { settings, changedFields };
}

// Makes a change show on the public page at once rather than up to five minutes later. It throws
// outside a request scope (route tests call handlers as plain functions) and can throw for reasons
// unrelated to the change, so a failure is logged and never undoes the write — the distribute
// route's precedent.
export function revalidateSignUpPage(slug: string, context: Record<string, unknown>): void {
  try {
    revalidatePath(`/public/${slug}`);
  } catch (error) {
    console.error(
      `Saved a Zoom sign-up change but could not refresh the public page — ${error instanceof Error ? error.message : String(error)}`,
      context,
    );
  }
}
