import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

// This is defence in depth, NOT the security boundary. RLS in migration 019 is what actually
// stops a cross-ward read (CLAUDE.md rule 2), and it stays in place whether or not a caller
// uses this module. The value here is that it removes a whole class of forgotten
// `.eq('ward_id', …)` filters. Neither one is redundant — do not delete either.

type Tables = Database["public"]["Tables"];

// `hymns` is the sole ward-less table (CLAUDE.md rule 1) and is excluded automatically by
// this mapped type rather than by a hand-maintained list, so a future ward-less table cannot
// silently join it.
export type WardScopedTable = {
  [Name in keyof Tables]: "ward_id" extends keyof Tables[Name]["Row"]
    ? Name
    : never;
}[keyof Tables];

export async function resolveSessionWardId(
  supabase: SupabaseClient<Database>,
): Promise<string> {
  const { data: authData, error: authError } = await supabase.auth.getUser();

  // A missing session surfaces as an error on some clients and as a null user on others, so
  // both are reported as the same condition. The underlying message is kept rather than
  // discarded — this is a thrown error, not a swallowed one.
  if (authError || !authData?.user) {
    throw new Error(
      "No signed-in user; a ward-scoped query needs a session." +
        (authError ? ` (${authError.message})` : ""),
    );
  }

  const { data, error } = await supabase
    .from("users")
    .select("ward_id")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Could not resolve the ward for user ${authData.user.id}: ${error.message}`,
    );
  }

  if (!data) {
    throw new Error(
      `Signed-in user ${authData.user.id} has no row in public.users, so no ward could be resolved.`,
    );
  }

  return data.ward_id;
}

// Returns the builder wrapped in an object rather than returning it directly. A
// PostgrestFilterBuilder is thenable, so an async function that returns one has its promise
// adopt it: awaiting the call would execute the query and hand back {data, error}, and the
// caller could never chain a further filter. foundation-c-services.md specifies
// `Promise<PostgrestFilterBuilder<…>>`, which is not expressible in JavaScript for that
// reason.
//
// Selects every column deliberately. A generic column-list parameter makes TypeScript
// instantiate PostgREST's recursive select parser once per table in WardScopedTable, which
// exhausts the compiler heap on this machine. Callers needing a projection should build the
// query in lib/<module>/queries.ts, which is where conventions.md puts query logic anyway.
export async function scopedQuery<Table extends WardScopedTable>(
  table: Table,
  client?: SupabaseClient<Database>,
) {
  const supabase = client ?? (await createServerSupabaseClient());
  const wardId = await resolveSessionWardId(supabase);

  const query = supabase.from(table).select("*");

  // WardScopedTable guarantees a ward_id column, but TypeScript cannot prove that while
  // Table is still generic, so the column name is asserted rather than inferred. The cast
  // narrows only the filter signature; the row type the caller sees is unchanged.
  const filterable = query as unknown as {
    eq: (column: "ward_id", value: string) => typeof query;
  };

  return { wardId, query: filterable.eq("ward_id", wardId) };
}

// Insert paths need the same ward without a select builder attached.
export async function scopedWardId(
  client?: SupabaseClient<Database>,
): Promise<string> {
  const supabase = client ?? (await createServerSupabaseClient());
  return resolveSessionWardId(supabase);
}
