import type { SupabaseClient } from "@supabase/supabase-js";
import { InvalidInputError } from "@/lib/auth/errors";
import { listBishopricUsers } from "@/lib/calendar/queries";
import { createMatchTodo, createWaitingLinkTodo } from "@/lib/todos/zoomLinks";
import type { PublicRegistrationInput } from "@/lib/validation/zoomRegistration";
import { type AnswerSnapshot, type AskedQuestion, checkAnswers } from "@/lib/zoom/registrationAnswers";
import { decideIntake, windowStart } from "@/lib/zoom/registrationLimits";
import { ZOOM_REGISTRATION_PAGE_TYPE } from "@/lib/zoom/registrationSettings";
import { createReferralCode, createStatusToken } from "@/lib/zoom/registrationTokens";
import type { Database, Json } from "@/types/database";
import type {
  ZoomRegistrationHeldReason,
  ZoomRegistrationQuestionAudience,
  ZoomRegistrationQuestionKind,
  ZoomRegistrationStatus,
} from "@/types/domain";

// PUBLIC ZOOM SIGN-UPS (ITER-052, migration 096e, plans/zoom-self-registration.md).
//
// submitRegistration() is the ONE public write. It runs with the service role behind
// POST /api/public/zoom-registrations, because `zoom_registrations` has no write policy and a
// member of the public has no session. It resolves the slug itself, so a request can only ever
// land in the ward whose page it names, and every query filters `ward_id` (rule 1).
//
// The list is read through the CALLER's client, where migration 096's policy admits the bishopric,
// the clerk and the executive secretary. It NAMES its columns: `status_token_hash` is hidden by a
// column grant, so `select("*")` is a 42501.
//
// NO name, phone, email, answer, token or referral code is ever logged here.

type Client = SupabaseClient<Database>;

// Every way a sign-up page can fail to exist or be closed. The route answers each with the same
// 404 and the same sentence (program-c's one outcome for every way of not existing).
export class RegistrationClosedError extends Error {
  constructor() {
    super("This sign-up page isn't available.");
    this.name = "RegistrationClosedError";
  }
}

export class RegistrationBusyError extends Error {
  constructor() {
    super("Lots of people are signing up right now. Please try again tomorrow.");
    this.name = "RegistrationBusyError";
  }
}

// The registration row was written and a later step failed. It carries what the route needs to
// audit the insert that DID happen (rule 6, ITER-053's finding) and to still hand the person their
// status page — their request exists, and the page tells them truthfully where it stands.
export class RegistrationFollowUpError extends Error {
  readonly registrationId: string;
  readonly wardId: string;
  readonly slug: string;
  readonly token: string;
  readonly approved: boolean;

  constructor(
    params: { registrationId: string; wardId: string; slug: string; token: string; approved: boolean },
    cause: unknown,
  ) {
    super("A Zoom sign-up was saved, but finishing it failed.");
    this.name = "RegistrationFollowUpError";
    this.registrationId = params.registrationId;
    this.wardId = params.wardId;
    this.slug = params.slug;
    this.token = params.token;
    this.approved = params.approved;
    this.cause = cause;
  }
}

const MAX_PHONE_DIGITS = 20;

export function phoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length > MAX_PHONE_DIGITS) {
    throw new InvalidInputError("That phone number is too long.");
  }
  return digits;
}

type WardPage = { wardId: string; slug: string; autoApprove: boolean };

async function resolveOpenPage(slug: string, service: Client): Promise<WardPage> {
  const { data: page, error } = await service
    .from("public_pages")
    .select("ward_id, slug")
    .eq("slug", slug)
    .eq("page_type", ZOOM_REGISTRATION_PAGE_TYPE)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a Zoom sign-up page — ${error.message}`);
    throw new Error(`Could not read the sign-up page: ${error.message}`);
  }
  if (!page) throw new RegistrationClosedError();

  const [settings, release] = await Promise.all([
    service
      .from("zoom_registration_settings")
      .select("is_open, auto_approve")
      .eq("ward_id", page.ward_id)
      .maybeSingle(),
    service
      .from("ward_release_settings")
      .select("released_modules")
      .eq("ward_id", page.ward_id)
      .maybeSingle(),
  ]);

  for (const result of [settings, release]) {
    if (result.error) {
      console.error(`Could not read a Zoom sign-up page's state — ${result.error.message}`, {
        wardId: page.ward_id,
      });
      throw new Error(`Could not read the sign-up page: ${result.error.message}`);
    }
  }

  const zoomReleased = !release.data || release.data.released_modules.includes("zoom");
  if (!settings.data?.is_open || !zoomReleased) throw new RegistrationClosedError();

  return { wardId: page.ward_id, slug: page.slug, autoApprove: settings.data.auto_approve };
}

async function readAskedQuestions(wardId: string, service: Client): Promise<AskedQuestion[]> {
  const { data, error } = await service
    .from("zoom_registration_questions")
    .select("id, prompt, kind, audience, is_required, shown_when_yes_to")
    .eq("ward_id", wardId)
    .eq("is_active", true)
    .order("position", { ascending: true });

  if (error) {
    console.error(`Could not read the Zoom sign-up questions — ${error.message}`, { wardId });
    throw new Error(`Could not read the sign-up questions: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    prompt: row.prompt,
    kind: row.kind as ZoomRegistrationQuestionKind,
    audience: row.audience as ZoomRegistrationQuestionAudience,
    isRequired: row.is_required,
    shownWhenYesTo: row.shown_when_yes_to,
  }));
}

type IntakeCounts = {
  recentCount: number;
  recentAutoApprovedCount: number;
  samePhoneExists: boolean;
};

async function readIntakeCounts(
  params: { wardId: string; phoneDigits: string; now: Date },
  service: Client,
): Promise<IntakeCounts> {
  const since = windowStart(params.now);

  const [recent, autoApproved, samePhone] = await Promise.all([
    service
      .from("zoom_registrations")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", params.wardId)
      .gte("created_at", since),
    service
      .from("zoom_registrations")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", params.wardId)
      .eq("status", "approved")
      .is("decided_by", null)
      .gte("decided_at", since),
    service
      .from("zoom_registrations")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", params.wardId)
      .eq("phone_digits", params.phoneDigits),
  ]);

  for (const result of [recent, autoApproved, samePhone]) {
    if (result.error) {
      console.error(`Could not count recent Zoom sign-ups — ${result.error.message}`, {
        wardId: params.wardId,
      });
      throw new Error(`Could not read recent sign-ups: ${result.error.message}`);
    }
  }

  return {
    recentCount: recent.count ?? 0,
    recentAutoApprovedCount: autoApproved.count ?? 0,
    samePhoneExists: (samePhone.count ?? 0) > 0,
  };
}

// An unknown code — or one from another ward — simply records no referrer (P13).
async function resolveReferrer(
  params: { wardId: string; referralCode: string | null },
  service: Client,
): Promise<string | null> {
  if (!params.referralCode) return null;

  const { data, error } = await service
    .from("zoom_registrations")
    .select("id")
    .eq("ward_id", params.wardId)
    .eq("referral_code", params.referralCode)
    .maybeSingle();

  if (error) {
    console.error(`Could not look up a Zoom sign-up referral — ${error.message}`, {
      wardId: params.wardId,
    });
    throw new Error(`Could not read the referral: ${error.message}`);
  }
  return data?.id ?? null;
}

type InsertFields = {
  wardId: string;
  input: PublicRegistrationInput;
  phoneDigits: string;
  answers: AnswerSnapshot[];
  heldReason: ZoomRegistrationHeldReason | null;
  referredBy: string | null;
};

const UNIQUE_VIOLATION = "23505";

// A fresh token and referral code each attempt; one retry covers the (vanishingly unlikely)
// collision on either unique column.
async function insertRegistration(
  fields: InsertFields,
  service: Client,
): Promise<{ registrationId: string; token: string }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { token, hash } = createStatusToken();

    const { data, error } = await service
      .from("zoom_registrations")
      .insert({
        ward_id: fields.wardId,
        display_name: fields.input.displayName,
        phone: fields.input.phone,
        phone_digits: fields.phoneDigits,
        email: fields.input.email,
        says_member: fields.input.saysMember,
        answers: fields.answers as unknown as Json,
        status: "pending",
        held_reason: fields.heldReason,
        status_token_hash: hash,
        referral_code: createReferralCode(),
        referred_by_registration_id: fields.referredBy,
      })
      .select("id")
      .single();

    if (!error) return { registrationId: data.id, token };
    if (error.code !== UNIQUE_VIOLATION || attempt === 1) {
      console.error(`Could not save a Zoom sign-up — ${error.message}`, { wardId: fields.wardId });
      throw new Error(`Could not save the sign-up: ${error.message}`);
    }
  }
  throw new Error("Could not save the sign-up.");
}

export type ApproveResult = { inviteeId: string; joinLinkId: string | null } | null;

// Status, invitee row and link in one transaction (migration 096, P3). Null when the request was
// no longer pending. `decidedBy` null means it was approved automatically.
export async function approveRegistration(
  params: { wardId: string; registrationId: string; decidedBy: string | null },
  service: Client,
): Promise<ApproveResult> {
  const { data, error } = await service.rpc("approve_zoom_registration", {
    p_ward_id: params.wardId,
    p_registration_id: params.registrationId,
    // The generated type marks every argument non-null; the function treats null as "automatic".
    p_decided_by: params.decidedBy as string,
  });

  if (error) {
    console.error(`Could not approve a Zoom sign-up — ${error.message}`, {
      wardId: params.wardId,
      registrationId: params.registrationId,
    });
    throw new Error(`Could not approve the sign-up: ${error.message}`);
  }

  const row = (data ?? [])[0];
  if (!row) return null;
  return { inviteeId: row.invitee_id, joinLinkId: row.join_link_id ?? null };
}

// The pool was empty at approval: every serving bishopric member gets "Give ___ a Zoom link", and
// giving the person a link from the Invitees tab closes every copy (ITER-053's mechanism).
export async function createWaitingLinkTodosForBishopric(
  params: { wardId: string; inviteeId: string; displayName: string },
  service: Client,
): Promise<string[]> {
  const bishopric = await listBishopricUsers(params.wardId, service);
  const todoIds: string[] = [];
  for (const member of bishopric) {
    todoIds.push(
      await createWaitingLinkTodo(
        {
          wardId: params.wardId,
          ownerUserId: member.id,
          inviteeId: params.inviteeId,
          displayName: params.displayName,
        },
        service,
      ),
    );
  }
  return todoIds;
}

// "I'm a member of the ward": every serving bishopric member gets "Match ___ to the roster", and
// the first match on Zoom → Sign-ups closes every copy (plan D3, z3b).
export async function createMatchTodosForBishopric(
  params: { wardId: string; registrationId: string; displayName: string },
  service: Client,
): Promise<string[]> {
  const bishopric = await listBishopricUsers(params.wardId, service);
  const todoIds: string[] = [];
  for (const member of bishopric) {
    todoIds.push(
      await createMatchTodo(
        {
          wardId: params.wardId,
          ownerUserId: member.id,
          registrationId: params.registrationId,
          displayName: params.displayName,
        },
        service,
      ),
    );
  }
  return todoIds;
}

export type SubmitResult =
  | { kind: "ignored" }
  | {
      kind: "saved";
      registrationId: string;
      wardId: string;
      slug: string;
      token: string;
      status: ZoomRegistrationStatus;
      heldReason: ZoomRegistrationHeldReason | null;
      linkGiven: boolean;
      waitingTodoIds: string[];
      matchTodoIds: string[];
      referred: boolean;
    };

export async function submitRegistration(
  input: PublicRegistrationInput,
  service: Client,
  now: Date = new Date(),
): Promise<SubmitResult> {
  const page = await resolveOpenPage(input.slug, service);

  // The honeypot: a person never sees the field. Nothing is written, and the route answers exactly
  // as it would for a real request so a bot learns nothing.
  if (input.website && input.website.trim() !== "") {
    console.warn("A Zoom sign-up was ignored: the hidden field was filled in.", {
      wardId: page.wardId,
    });
    return { kind: "ignored" };
  }

  const digits = phoneDigits(input.phone);
  const questions = await readAskedQuestions(page.wardId, service);
  const checked = checkAnswers(questions, input.saysMember, input.answers);
  if (!checked.ok) throw new InvalidInputError(checked.error);

  const counts = await readIntakeCounts({ wardId: page.wardId, phoneDigits: digits, now }, service);
  const decision = decideIntake({ ...counts, autoApprove: page.autoApprove });
  if (decision.kind === "refuse_busy") throw new RegistrationBusyError();

  const referredBy = await resolveReferrer(
    { wardId: page.wardId, referralCode: input.ref },
    service,
  );

  const heldReason = decision.kind === "pending" ? decision.heldReason : null;
  const { registrationId, token } = await insertRegistration(
    {
      wardId: page.wardId,
      input,
      phoneDigits: digits,
      answers: checked.answers,
      heldReason,
      referredBy,
    },
    service,
  );

  const base = {
    kind: "saved" as const,
    registrationId,
    wardId: page.wardId,
    slug: page.slug,
    token,
    referred: referredBy !== null,
  };

  const createMatchTodos = async (approved: boolean): Promise<string[]> => {
    if (!input.saysMember) return [];
    try {
      return await createMatchTodosForBishopric(
        { wardId: page.wardId, registrationId, displayName: input.displayName },
        service,
      );
    } catch (error) {
      throw new RegistrationFollowUpError(
        { registrationId, wardId: page.wardId, slug: page.slug, token, approved },
        error,
      );
    }
  };

  if (decision.kind === "pending") {
    const matchTodoIds = await createMatchTodos(false);
    return { ...base, status: "pending", heldReason, linkGiven: false, waitingTodoIds: [], matchTodoIds };
  }

  let approved: ApproveResult;
  try {
    approved = await approveRegistration(
      { wardId: page.wardId, registrationId, decidedBy: null },
      service,
    );
  } catch (error) {
    throw new RegistrationFollowUpError(
      { registrationId, wardId: page.wardId, slug: page.slug, token, approved: false },
      error,
    );
  }
  if (!approved) {
    throw new RegistrationFollowUpError(
      { registrationId, wardId: page.wardId, slug: page.slug, token, approved: false },
      new Error("The new sign-up was not pending when it was approved."),
    );
  }

  let waitingTodoIds: string[] = [];
  if (approved.joinLinkId === null) {
    try {
      waitingTodoIds = await createWaitingLinkTodosForBishopric(
        { wardId: page.wardId, inviteeId: approved.inviteeId, displayName: input.displayName },
        service,
      );
    } catch (error) {
      throw new RegistrationFollowUpError(
        { registrationId, wardId: page.wardId, slug: page.slug, token, approved: true },
        error,
      );
    }
  }

  const matchTodoIds = await createMatchTodos(true);

  return {
    ...base,
    status: "approved",
    heldReason: null,
    linkGiven: approved.joinLinkId !== null,
    waitingTodoIds,
    matchTodoIds,
  };
}

// ---------------------------------------------------------------------------------------------
// THE LIST ON ZOOM → SIGN-UPS
// ---------------------------------------------------------------------------------------------

export type RegistrationResponse = {
  userId: string;
  name: string;
  response: "approve" | "talk_first";
};

export type ZoomRegistration = {
  id: string;
  displayName: string;
  phone: string;
  phoneDigits: string;
  email: string | null;
  saysMember: boolean;
  answers: AnswerSnapshot[];
  status: ZoomRegistrationStatus;
  heldReason: ZoomRegistrationHeldReason | null;
  memberId: string | null;
  memberName: string | null;
  referrerName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  inviteeId: string | null;
  // Null until approved and given a link.
  placeholderName: string | null;
  linkGiven: boolean;
  responses: RegistrationResponse[];
  createdAt: string;
};

const REGISTRATION_COLUMNS =
  "id, display_name, phone, phone_digits, email, says_member, answers, status, held_reason, " +
  "member_id, decided_at, invitee_id, created_at, referred_by_registration_id, " +
  "member:members!zoom_registrations_member_id_ward_id_fkey (first_name, last_name), " +
  "decider:users!zoom_registrations_decided_by_fkey (first_name, last_name), " +
  "invitee:zoom_invitees!zoom_registrations_invitee_id_ward_id_fkey (link_given_at, " +
  "zoom_join_links!zoom_invitees_join_link_id_ward_id_fkey (placeholder_name)), " +
  "zoom_registration_responses (user_id, response, " +
  "responder:users!zoom_registration_responses_user_id_fkey (first_name, last_name))";

type OneOrMany<T> = T | T[] | null;

type Person = { first_name: string | null; last_name: string | null };

type RegistrationRow = {
  id: string;
  display_name: string;
  phone: string;
  phone_digits: string;
  email: string | null;
  says_member: boolean;
  answers: Json;
  status: string;
  held_reason: string | null;
  member_id: string | null;
  decided_at: string | null;
  invitee_id: string | null;
  created_at: string;
  referred_by_registration_id: string | null;
  member: OneOrMany<Person>;
  decider: OneOrMany<Person>;
  invitee: OneOrMany<{
    link_given_at: string | null;
    zoom_join_links: OneOrMany<{ placeholder_name: string }>;
  }>;
  zoom_registration_responses: {
    user_id: string;
    response: string;
    responder: OneOrMany<Person>;
  }[] | null;
};

function first<T>(value: OneOrMany<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function fullName(person: Person | null): string | null {
  if (!person) return null;
  const name = [person.first_name, person.last_name].filter(Boolean).join(" ").trim();
  return name === "" ? null : name;
}

function isAnswerSnapshot(value: unknown): value is AnswerSnapshot {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.questionId === "string" &&
    typeof entry.prompt === "string" &&
    (entry.kind === "yes_no" || entry.kind === "short_text") &&
    (typeof entry.answer === "string" || typeof entry.answer === "boolean")
  );
}

function toAnswers(value: Json): AnswerSnapshot[] {
  return Array.isArray(value) ? value.filter(isAnswerSnapshot) : [];
}

// PostgREST cannot embed zoom_registrations into itself through the (id, ward_id) key, so the
// referrer's name is a second read by id.
async function readReferrerNames(
  wardId: string,
  rows: RegistrationRow[],
  client: Client,
): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((row) => row.referred_by_registration_id).filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();

  const { data, error } = await client
    .from("zoom_registrations")
    .select("id, display_name")
    .eq("ward_id", wardId)
    .in("id", ids);

  if (error) {
    console.error(`Could not read who referred the Zoom sign-ups — ${error.message}`, { wardId });
    throw new Error(`Could not read the sign-ups: ${error.message}`);
  }

  return new Map((data ?? []).map((row) => [row.id, row.display_name]));
}

function toRegistration(row: RegistrationRow, referrerNames: Map<string, string>): ZoomRegistration {
  const invitee = first(row.invitee);
  const link = invitee ? first(invitee.zoom_join_links) : null;
  return {
    id: row.id,
    displayName: row.display_name,
    phone: row.phone,
    phoneDigits: row.phone_digits,
    email: row.email,
    saysMember: row.says_member,
    answers: toAnswers(row.answers),
    status: row.status as ZoomRegistrationStatus,
    heldReason: row.held_reason as ZoomRegistrationHeldReason | null,
    memberId: row.member_id,
    memberName: fullName(first(row.member)),
    referrerName: row.referred_by_registration_id
      ? (referrerNames.get(row.referred_by_registration_id) ?? null)
      : null,
    decidedByName: fullName(first(row.decider)),
    decidedAt: row.decided_at,
    inviteeId: row.invitee_id,
    placeholderName: link?.placeholder_name ?? null,
    linkGiven: invitee?.link_given_at != null,
    responses: (row.zoom_registration_responses ?? []).map((response) => ({
      userId: response.user_id,
      name: fullName(first(response.responder)) ?? "A member of the bishopric",
      response: response.response === "talk_first" ? "talk_first" : "approve",
    })),
    createdAt: row.created_at,
  };
}

// Newest first. The panel splits Waiting from Recent and orders each itself.
export async function listRegistrations(wardId: string, supabase: Client): Promise<ZoomRegistration[]> {
  const { data, error } = await supabase
    .from("zoom_registrations")
    .select(REGISTRATION_COLUMNS)
    .eq("ward_id", wardId)
    .order("created_at", { ascending: false })
    .returns<RegistrationRow[]>();

  if (error) {
    console.error(`Could not read the Zoom sign-ups — ${error.message}`, { wardId });
    throw new Error(`Could not read the sign-ups: ${error.message}`);
  }

  const rows = data ?? [];
  const referrerNames = await readReferrerNames(wardId, rows, supabase);
  return rows.map((row) => toRegistration(row, referrerNames));
}

export async function readRegistration(
  params: { wardId: string; registrationId: string },
  client: Client,
): Promise<ZoomRegistration | null> {
  const { data, error } = await client
    .from("zoom_registrations")
    .select(REGISTRATION_COLUMNS)
    .eq("ward_id", params.wardId)
    .eq("id", params.registrationId)
    .returns<RegistrationRow[]>()
    .maybeSingle();

  if (error) {
    console.error(`Could not read a Zoom sign-up — ${error.message}`, params);
    throw new Error(`Could not read the sign-up: ${error.message}`);
  }

  if (!data) return null;
  const referrerNames = await readReferrerNames(params.wardId, [data], client);
  return toRegistration(data, referrerNames);
}
