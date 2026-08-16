import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type WriteAuditLogParams = {
  wardId: string;
  userId: string;
  action: string;
  module: string;
  detail?: Record<string, unknown>;
};

const REDACTED = "[redacted]";
const MAX_DEPTH = 4;

// A backstop, not the rule. The rule is that callers pass ids and short descriptions
// (CLAUDE.md rule 8, conventions.md §Error Handling). `note` is included deliberately even
// though it over-matches: an audit row is bishopric-readable, and a private note landing in
// one would defeat CLAUDE.md rule 5 entirely.
const SENSITIVE_KEY_PATTERN =
  /pin|token|secret|password|passcode|credential|api[_-]?key|\bkey\b|hash|authorization|note/i;

function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) return REDACTED;

  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitive(entry, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key)
          ? REDACTED
          : redactSensitive(entry, depth + 1),
      ]),
    );
  }

  return value;
}

// Never throws. An audit write failure must not fail the user's action — this is one of
// exactly two sanctioned exceptions to CLAUDE.md rule 7 (emitNotification is the other).
// It still logs with context; it does not swallow silently.
export async function writeAuditLog(
  params: WriteAuditLogParams,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const { wardId, userId, action, module, detail } = params;

  try {
    const supabase = client ?? (await createServerSupabaseClient());

    const { error } = await supabase.from("audit_log").insert({
      ward_id: wardId,
      user_id: userId,
      action,
      module,
      detail: (detail === undefined
        ? null
        : redactSensitive(detail)) as Database["public"]["Tables"]["audit_log"]["Insert"]["detail"],
    });

    if (error) {
      console.error("Audit log write rejected by the database", {
        wardId,
        userId,
        action,
        module,
        error: error.message,
      });
    }
  } catch (error) {
    console.error("Audit log write threw", {
      wardId,
      userId,
      action,
      module,
      error,
    });
  }
}
