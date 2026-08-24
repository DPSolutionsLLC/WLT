import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// WRITE-ONLY IN THIS PLAN. `retrieval_suggestions` exists now, and is written on every
// retrieval, because ITER-012's display reads MONTHS of history that cannot be backfilled —
// every week without this write is a week permanently missing from the denominator of
// "appeared in 8 of your last 20 generations". The percentage UI is a separate, cheap piece of
// work whenever it is wanted; the telemetry is not, which is why only this half ships.
//
// SERVER-ONLY: it takes a Supabase client and uses node:crypto.
//
// WHAT THIS NEVER STORES: the query, the prompt, the retrieved text, or anything generated.
// Document ids and a timestamp. A bishop's retrieval query can name a specific member or
// describe a situation that member would not want written down — the same rule lib/ai/retrieve.ts
// applies to its console logging and `ai-c` applies to its audit rows.

export type SuggestionRun = {
  runId: string;
  module: string;
  documentIds: readonly string[];
};

// One id per retrieveChunks call, shared by every document that call returned. It is what makes
// the ITER-012 percentage answerable at all: without it you can count how often a document
// appeared but you have nothing to divide by.
export function newRunId(): string {
  return randomUUID();
}

// RETURNS, NEVER THROWS. THIS IS THE ONE PLACE IN THIS CODEBASE WHERE SWALLOWING IS CORRECT,
// AND IT NEEDS THE REASON WRITTEN DOWN OR A FUTURE READER WILL RIGHTLY CALL IT A §7 VIOLATION.
//
// This is a logging table. A failed insert into it costs a row of future telemetry. Letting that
// failure propagate would abort a topic generation the bishopric is waiting on, after the
// Anthropic call has already been paid for — trading something they need for something nobody
// has looked at yet. The failure is LOGGED SERVER-SIDE with its message, so it is discoverable;
// it is simply not allowed to take down the feature it is measuring.
//
// Nothing about the retrieval result depends on the outcome, which is why the caller ignores it.
export async function recordSuggestions(
  wardId: string,
  run: SuggestionRun,
  client: SupabaseClient<Database>,
): Promise<void> {
  // Nothing retrieved is a real and common outcome — a ward with no corpus, or a query nothing
  // matched. There is no run to record, and an empty insert would be a round trip for nothing.
  if (run.documentIds.length === 0) return;

  try {
    const { error } = await client.from("retrieval_suggestions").insert(
      run.documentIds.map((documentId) => ({
        ward_id: wardId,
        run_id: run.runId,
        module: run.module,
        document_id: documentId,
      })),
    );

    if (error) {
      console.error(
        `Could not record which documents retrieval suggested — ${error.message}`,
        { wardId, module: run.module, documentCount: run.documentIds.length },
      );
    }
  } catch (error) {
    console.error(
      `Could not record which documents retrieval suggested — ${
        error instanceof Error ? error.message : String(error)
      }`,
      { wardId, module: run.module },
    );
  }
}
