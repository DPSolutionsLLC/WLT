import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  CreateHouseholdInput,
  CreateMemberInput,
  MemberFilters,
  UpdateHouseholdInput,
  UpdateMemberInput,
} from "@/lib/validation/roster";
import type { Database } from "@/types/database";
import {
  MEMBER_CATEGORIES,
  MEMBER_GENDERS,
  MEMBER_STATUSES,
  type MemberCategory,
  type MemberGender,
  type MemberStatus,
} from "@/types/domain";

// Every roster read and write goes through this module. Route handlers and pages never touch
// Supabase directly (conventions.md §Data Access), which is what keeps the ward scope and the
// status default in one place instead of re-derived at every call site.
//
// This module never selects from member_notes. Notes live in lib/roster/memberNotes.ts so that
// "did this response include notes?" is answerable by reading an import list.

export type Household = {
  id: string;
  familyName: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
};

export type Member = {
  id: string;
  householdId: string | null;
  firstName: string;
  lastName: string;
  category: MemberCategory | null;
  gender: MemberGender | null;
  status: MemberStatus;
  phone: string | null;
  createdAt: string;
};

export type HouseholdWithMembers = Household & { members: Member[] };
export type MemberDetail = Member & { household: Household | null };

export type HouseholdRow = {
  id: string;
  family_name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
};

export type MemberRow = {
  id: string;
  household_id: string | null;
  first_name: string;
  last_name: string;
  category: string | null;
  gender: string | null;
  status: string;
  phone: string | null;
  created_at: string;
};

const HOUSEHOLD_COLUMNS = "id, family_name, address, latitude, longitude, created_at";
const MEMBER_COLUMNS =
  "id, household_id, first_name, last_name, category, gender, status, phone, created_at";

// The single most important line in this file. A caller who forgets to say what it wants gets
// active members only, so a moved-out member can never quietly inflate a speaker rotation, a
// visit-goal denominator, or a ward count (02-roster.md §Pitfalls opens with exactly that bug).
// Widening this default is a decision about every downstream number in the app.
export const DEFAULT_MEMBER_STATUSES: readonly MemberStatus[] = ["active"];

// The /roster browse page opts in to do_not_contact explicitly: it is a browse surface rather
// than a calculation, and a do-not-contact member is still in the ward. moved_out needs an
// explicit opt-in from both.
export const ROSTER_BROWSE_STATUSES: readonly MemberStatus[] = ["active", "do_not_contact"];

// An empty array falls back to the default rather than being honoured. `.in("status", [])`
// matches nothing, so an empty array — almost always a caller bug — would silently empty a
// page instead of failing.
export function resolveMemberStatuses(opts?: {
  statuses?: readonly MemberStatus[];
}): readonly MemberStatus[] {
  const requested = opts?.statuses;
  if (!requested || requested.length === 0) return DEFAULT_MEMBER_STATUSES;
  return requested;
}

// A free-text term ends up inside an ILIKE pattern which is then interpolated into PostgREST's
// `or` filter. That filter is comma-delimited and gives `.`, `(`, `)` and `"` their own
// meaning, and ILIKE gives `%` and `_` theirs. Both classes are removed rather than escaped:
// an escape would have to survive two grammars in the right order, and a search box that
// quietly ignores a comma is a much smaller problem than one whose filter has been rewritten.
//
// Returns null when nothing searchable is left. Callers must treat that as "no results", not
// as "no filter" — a term of `%` reaching the whole ward would show MORE than was asked for,
// and that is the wrong direction for a search to fail in.
export function toSearchPattern(term: string): string | null {
  const neutralised = term
    .replace(/[%_,().\\"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return neutralised === "" ? null : `%${neutralised}%`;
}

// The CHECK constraints in migration 003 already restrict these columns, so an unrecognised
// value means the constraint and types/domain.ts have drifted. Throwing is the only safe
// answer — the same reasoning as toRole() in lib/auth/session.ts.
function toEnumValue<Value extends string>(
  value: string,
  allowed: readonly Value[],
  column: string,
): Value {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(
      `members.${column} holds "${value}", which is not a known value. The CHECK constraint ` +
        "in migration 003 and types/domain.ts have drifted.",
    );
  }
  return value as Value;
}

export function mapHouseholdRow(row: HouseholdRow): Household {
  return {
    id: row.id,
    familyName: row.family_name,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    createdAt: row.created_at,
  };
}

// Builds an explicit object rather than spreading the row. A column added to `members` later
// cannot ride along into a response nobody reviewed.
export function mapMemberRow(row: MemberRow): Member {
  return {
    id: row.id,
    householdId: row.household_id,
    firstName: row.first_name,
    lastName: row.last_name,
    category:
      row.category === null
        ? null
        : toEnumValue(row.category, MEMBER_CATEGORIES, "category"),
    gender:
      row.gender === null ? null : toEnumValue(row.gender, MEMBER_GENDERS, "gender"),
    status: toEnumValue(row.status, MEMBER_STATUSES, "status"),
    phone: row.phone,
    createdAt: row.created_at,
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

async function readMemberIdsInOrganization(
  supabase: SupabaseClient<Database>,
  wardId: string,
  organizationId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("member_organizations")
    .select("member_id")
    .eq("ward_id", wardId)
    .eq("org_id", organizationId);

  if (error) {
    console.error(
      `Could not read the organization's members — ${error.message}`,
      { wardId, organizationId },
    );
    throw new Error(`Could not read the organization's members: ${error.message}`);
  }

  return (data ?? []).map((row) => row.member_id);
}

async function readHouseholdIdsByFamilyName(
  supabase: SupabaseClient<Database>,
  wardId: string,
  pattern: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("households")
    .select("id")
    .eq("ward_id", wardId)
    .ilike("family_name", pattern);

  if (error) {
    console.error(`Could not search households by family name — ${error.message}`, {
      wardId,
    });
    throw new Error(`Could not search the ward's households: ${error.message}`);
  }

  return (data ?? []).map((row) => row.id);
}

// `statuses` is replaced rather than intersected: memberFiltersSchema infers a mutable array,
// and intersecting it with a readonly one produces a type nothing satisfies.
export type ListMembersOptions = Omit<MemberFilters, "statuses"> & {
  statuses?: readonly MemberStatus[];
};

export async function listMembers(
  wardId: string,
  opts?: ListMembersOptions,
  client?: SupabaseClient<Database>,
): Promise<Member[]> {
  const supabase = await resolveClient(client);
  const statuses = resolveMemberStatuses(opts);

  let query = supabase
    .from("members")
    .select(MEMBER_COLUMNS)
    .eq("ward_id", wardId)
    .in("status", statuses);

  if (opts?.category) {
    query = query.eq("category", opts.category);
  }

  if (opts?.organizationId) {
    const memberIds = await readMemberIdsInOrganization(
      supabase,
      wardId,
      opts.organizationId,
    );
    if (memberIds.length === 0) return [];
    query = query.in("id", memberIds);
  }

  const searchTerm = opts?.search?.trim();

  if (searchTerm) {
    const pattern = toSearchPattern(searchTerm);

    // Something was typed, and none of it survived neutralisation. No results is the honest
    // answer; skipping the filter would hand back the whole ward.
    if (pattern === null) return [];

    // A member matches by their own name or by the family name of their household, which is
    // resolved first because the two live in different tables.
    const householdIds = await readHouseholdIdsByFamilyName(supabase, wardId, pattern);

    const conditions = [`first_name.ilike.${pattern}`, `last_name.ilike.${pattern}`];
    if (householdIds.length > 0) {
      conditions.push(`household_id.in.(${householdIds.join(",")})`);
    }

    query = query.or(conditions.join(","));
  }

  const { data, error } = await query
    .order("last_name", { nullsFirst: false })
    .order("first_name", { nullsFirst: false });

  if (error) {
    console.error(`Could not read the ward's members — ${error.message}`, { wardId });
    throw new Error(`Could not read the ward's members: ${error.message}`);
  }

  return (data ?? []).map(mapMemberRow);
}

async function readMembersForHouseholds(
  supabase: SupabaseClient<Database>,
  wardId: string,
  householdIds: string[],
  statuses: readonly MemberStatus[],
  category?: MemberCategory,
): Promise<Member[]> {
  if (householdIds.length === 0) return [];

  let query = supabase
    .from("members")
    .select(MEMBER_COLUMNS)
    .eq("ward_id", wardId)
    .in("household_id", householdIds)
    .in("status", statuses);

  if (category) {
    query = query.eq("category", category);
  }

  const { data, error } = await query
    .order("last_name", { nullsFirst: false })
    .order("first_name", { nullsFirst: false });

  if (error) {
    console.error(`Could not read household members — ${error.message}`, { wardId });
    throw new Error(`Could not read the households' members: ${error.message}`);
  }

  return (data ?? []).map(mapMemberRow);
}

function groupByHousehold(
  households: Household[],
  members: Member[],
): HouseholdWithMembers[] {
  const byHousehold = new Map<string, Member[]>();

  for (const member of members) {
    if (!member.householdId) continue;
    const existing = byHousehold.get(member.householdId);
    if (existing) {
      existing.push(member);
    } else {
      byHousehold.set(member.householdId, [member]);
    }
  }

  return households.map((household) => ({
    ...household,
    members: byHousehold.get(household.id) ?? [],
  }));
}

// `category` narrows the members shown inside each household rather than the households
// themselves: a household whose members all filter out still appears, with an empty expand.
// Dropping it would make the household count move whenever a category is selected, and that
// count is the one number on the page a reader trusts.
export type ListHouseholdsOptions = {
  search?: string;
  statuses?: readonly MemberStatus[];
  category?: MemberCategory;
};

// Two queries and an in-memory group rather than a PostgREST embed, for the reason
// listWardUsers gives: the foreign key is composite ((household_id, ward_id) → households
// (id, ward_id)) and an embed across it is more fragile than a second small read.
export async function listHouseholds(
  wardId: string,
  opts?: ListHouseholdsOptions,
  client?: SupabaseClient<Database>,
): Promise<HouseholdWithMembers[]> {
  const supabase = await resolveClient(client);
  const statuses = resolveMemberStatuses(opts);
  const searchTerm = opts?.search?.trim();

  let query = supabase
    .from("households")
    .select(HOUSEHOLD_COLUMNS)
    .eq("ward_id", wardId);

  if (searchTerm) {
    const pattern = toSearchPattern(searchTerm);

    // Same rule as listMembers: a term that neutralises to nothing means no results, never the
    // whole ward.
    if (pattern === null) return [];

    // A search matches a household by its family name OR by the name of someone living in it,
    // so the matching members are resolved first and their households folded into the filter.
    const matchingMembers = await listMembers(wardId, { search: searchTerm, statuses }, supabase);
    const householdIdsFromMembers = matchingMembers
      .map((member) => member.householdId)
      .filter((id): id is string => id !== null);

    const conditions = [`family_name.ilike.${pattern}`];
    if (householdIdsFromMembers.length > 0) {
      conditions.push(`id.in.(${[...new Set(householdIdsFromMembers)].join(",")})`);
    }

    query = query.or(conditions.join(","));
  }

  const { data, error } = await query.order("family_name", { nullsFirst: false });

  if (error) {
    console.error(`Could not read the ward's households — ${error.message}`, { wardId });
    throw new Error(`Could not read the ward's households: ${error.message}`);
  }

  const households = (data ?? []).map(mapHouseholdRow);

  // Every member of a matched household, not only the ones whose name matched: expanding a
  // household that came up in a search should show the whole family.
  const members = await readMembersForHouseholds(
    supabase,
    wardId,
    households.map((household) => household.id),
    statuses,
    opts?.category,
  );

  return groupByHousehold(households, members);
}

// No status filter. This is a detail surface reached by id, not a calculation, and a member
// who has moved out still has a page — the badge says so.
export async function getMember(
  wardId: string,
  memberId: string,
  client?: SupabaseClient<Database>,
): Promise<MemberDetail | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("members")
    .select(MEMBER_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", memberId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a member — ${error.message}`, { wardId, memberId });
    throw new Error(`Could not read that member: ${error.message}`);
  }

  if (!data) return null;

  const member = mapMemberRow(data);
  if (!member.householdId) return { ...member, household: null };

  const { data: householdRow, error: householdError } = await supabase
    .from("households")
    .select(HOUSEHOLD_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", member.householdId)
    .maybeSingle();

  if (householdError) {
    console.error(`Could not read a member's household — ${householdError.message}`, {
      wardId,
      memberId,
    });
    throw new Error(`Could not read that member's household: ${householdError.message}`);
  }

  return {
    ...member,
    household: householdRow ? mapHouseholdRow(householdRow) : null,
  };
}

// Every status, for the same reason getMember applies none: a household page that hid the
// member who moved out would make them unreachable from the only page that lists their family.
export async function getHousehold(
  wardId: string,
  householdId: string,
  client?: SupabaseClient<Database>,
): Promise<HouseholdWithMembers | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("households")
    .select(HOUSEHOLD_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", householdId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a household — ${error.message}`, {
      wardId,
      householdId,
    });
    throw new Error(`Could not read that household: ${error.message}`);
  }

  if (!data) return null;

  const household = mapHouseholdRow(data);
  const members = await readMembersForHouseholds(
    supabase,
    wardId,
    [household.id],
    MEMBER_STATUSES,
  );

  return { ...household, members };
}

export async function createHousehold(
  wardId: string,
  input: CreateHouseholdInput,
  client?: SupabaseClient<Database>,
): Promise<Household> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("households")
    .insert({
      ward_id: wardId,
      family_name: input.familyName,
      address: input.address ?? null,
    })
    .select(HOUSEHOLD_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not create a household — ${error.message}`, { wardId });
    throw new Error(`Could not create the household: ${error.message}`);
  }

  return mapHouseholdRow(data);
}

// Returns null rather than throwing when nothing was updated. An UPDATE denied by policy comes
// back as success with zero rows, not an error (plans/retros/foundation-c-services.md), so a
// row that is not in this ward and a row RLS refused are indistinguishable here — both mean
// "not yours", which the route turns into a 404.
export async function updateHousehold(
  wardId: string,
  householdId: string,
  input: UpdateHouseholdInput,
  client?: SupabaseClient<Database>,
): Promise<Household | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("households")
    .update({
      ...(input.familyName !== undefined ? { family_name: input.familyName } : {}),
      ...(input.address !== undefined ? { address: input.address ?? null } : {}),
    })
    .eq("ward_id", wardId)
    .eq("id", householdId)
    .select(HOUSEHOLD_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not update a household — ${error.message}`, {
      wardId,
      householdId,
    });
    throw new Error(`Could not update the household: ${error.message}`);
  }

  return data ? mapHouseholdRow(data) : null;
}

export async function createMember(
  wardId: string,
  input: CreateMemberInput,
  client?: SupabaseClient<Database>,
): Promise<Member> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("members")
    .insert({
      ward_id: wardId,
      household_id: input.householdId ?? null,
      first_name: input.firstName,
      last_name: input.lastName,
      category: input.category ?? null,
      gender: input.gender ?? null,
      status: input.status,
      phone: input.phone ?? null,
    })
    .select(MEMBER_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not create a member — ${error.message}`, { wardId });
    throw new Error(`Could not create the member: ${error.message}`);
  }

  return mapMemberRow(data);
}

export async function updateMember(
  wardId: string,
  memberId: string,
  input: UpdateMemberInput,
  client?: SupabaseClient<Database>,
): Promise<Member | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("members")
    .update({
      ...(input.householdId !== undefined
        ? { household_id: input.householdId ?? null }
        : {}),
      ...(input.firstName !== undefined ? { first_name: input.firstName } : {}),
      ...(input.lastName !== undefined ? { last_name: input.lastName } : {}),
      ...(input.category !== undefined ? { category: input.category ?? null } : {}),
      ...(input.gender !== undefined ? { gender: input.gender ?? null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
    })
    .eq("ward_id", wardId)
    .eq("id", memberId)
    .select(MEMBER_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not update a member — ${error.message}`, { wardId, memberId });
    throw new Error(`Could not update the member: ${error.message}`);
  }

  return data ? mapMemberRow(data) : null;
}
