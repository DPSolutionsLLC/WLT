# Plan: AI A — Claude Client, System Prompt, AI Settings Panel

**Created:** 2026-08-23
**Type:** feature
**Structure:** Sequential — plan 1 of 3 for Phase 5 ([05-ai-platform.md](05-ai-platform.md))
**Next:** [ai-b-knowledge-and-retrieval.md](ai-b-knowledge-and-retrieval.md), then [ai-c-feature-routes.md](ai-c-feature-routes.md)

---

## Overview

The first real Claude call in this app, and the panel that configures every later one.

Three things ship together because they only prove each other when they do: the **client**
(model, thinking, effort, typed error handling), the **system prompt assembler** (layers 1
and 2, with the cache breakpoint), and the **AI Settings panel** (seven sections, append-only
versioning, history, restore, and a preview that runs against *unsaved* draft settings).

The preview panel is why these belong in one slice. It is the only surface in the app that
exercises the client end to end, and it needs no knowledge base — a ward with zero documents
gets a system prompt with layers 1 and 2 and no layer 3, which is a legitimate, testable state.
Retrieval arrives in `ai-b` and slots in behind an already-proven interface.

**Success criteria**

- A bishopric member opens `/ai-settings`, fills in seven sections, types a test prompt, clicks
  Preview, and reads real Claude output — **before** saving anything.
- Saving appends a version. Restoring an old version appends another. No row is ever updated or
  deleted; history cannot be destroyed.
- `ANTHROPIC_API_KEY` is unreachable from the browser, and a test proves it.
- Rate limit, refusal, truncation, connection failure, and missing-key each surface a **distinct**
  actionable message — never an empty draft.
- The cache breakpoint sits at the end of the stable content, with nothing volatile above it.

---

## Relevant Files

### Create

| File | What it does |
|---|---|
| `lib/ai/errors.ts` | `AiRequestError` — kind, user-facing message, HTTP status |
| `lib/ai/client.ts` | Anthropic client factory, `MODEL`, `callClaude()`, `callClaudeStructured()` |
| `lib/ai/moduleInstructions.ts` | Static per-module system-prompt block, one per `AiModule` |
| `lib/ai/systemPrompt.ts` | `buildSystemPrompt()` — **pure**, returns `Anthropic.TextBlockParam[]` |
| `lib/ai/queries.ts` | `ai_settings` reads and the append-only insert |
| `lib/validation/aiSettings.ts` | Zod schemas for settings input and the preview body |
| `app/api/ai-settings/route.ts` | GET active, POST new version |
| `app/api/ai-settings/history/route.ts` | GET all versions |
| `app/api/ai-settings/restore/[id]/route.ts` | POST — copy a version forward |
| `app/api/ai-settings/preview/route.ts` | POST — run a test prompt against draft settings |
| `app/(app)/ai-settings/page.tsx` | Server page, `ai_settings.view` guard |
| `app/(app)/ai-settings/AiSettingsForm.tsx` | Client — seven sections, save |
| `app/(app)/ai-settings/PreviewPanel.tsx` | Client — test prompt against the current form state |
| `app/(app)/ai-settings/VersionHistory.tsx` | Client — list + restore |

### Modify

| File | What changes |
|---|---|
| `types/domain.ts` | `AI_MODULES`, `STANDARD_WORKS`, `ScripturePreferences`, `ConferencePreferences`, labels |
| `lib/auth/routeErrors.ts` | One branch mapping `AiRequestError` to its own status and message |

**Nothing else.** `.env.local.example` already lists `ANTHROPIC_API_KEY`. `NAVIGATION_ITEMS`
already has `{ label: "AI Settings", href: "/ai-settings", permission: "ai_settings.view" }` —
that link currently 404s, and this plan is what makes it resolve. Migration 014 already created
the `ai_settings` table and migration 019 already put it in the bishopric-only RLS loop. **There
is no migration in this plan.**

---

## Dependencies

- **`@anthropic-ai/sdk` 0.117.1** — already installed. No new dependency.
- **`zod` 4.4.3** — already installed. Required by `zodOutputFormat`, which imports `zod/v4`.
- Existing helpers, all of which take an optional client as their last argument:
  `requireSessionUser`, `resolveRoleAccess` / `can` / `assertCan`, `readJsonBody` /
  `respondToRouteError`, `writeAuditLog`, `notifyOtherBishopric`, `NotPermitted`.

---

## Known Pitfalls (from retro context)

- **[foundation-c-services]** — `can()` and `assertCan()` take role access as a **required** third
  argument. Resolve it once per route into a local and pass it down; `cache()` does not dedupe in a
  route handler.
- **[route-tests-and-realtime]** — *Order any query you then index into.* "The active settings row"
  is `.order("created_at", { ascending: false })` **plus** `.order("id", { ascending: false })` as a
  tie-break, then `.limit(1)`. Two saves inside the same second are not hypothetical on an
  append-only table, and heap order moves as other suites write rows.
- **[route-tests-and-realtime]** — `vi.mock` is hoisted above every import. Read the header comment
  in `tests/helpers/routeClient.ts` before writing the first route test.
- **[talks-c-prayers-topics]** — a bash heredoc broke on a file containing a PostgREST embedded-join
  select. Write TypeScript files with the Write tool, not a heredoc.
- **[talks-c-prayers-topics]** — `Input` requires an `id` prop. The settings form has seven sections
  on one page; give every field a distinct id or labels point at the wrong input.
- **[roster-b-picker-and-orgs]** — client components must not import a module that reaches
  `next/headers`. `lib/ai/systemPrompt.ts` and `lib/ai/moduleInstructions.ts` are **pure** and safe
  to import anywhere; `lib/ai/queries.ts` and `lib/ai/client.ts` are server-only.
- **[auth-b-invites-admin]** — a `ForbiddenError` escaping a Server Component becomes a 500 whose
  message Next.js strips in production. Pages use `can()` + `<NotPermitted />`; routes use
  `assertCan()`.

---

## API Facts — verified against the installed SDK, not from memory

The phase plan's sketch is close but not exact. These were checked against
`node_modules/@anthropic-ai/sdk@0.117.1` and the `claude-api` skill on 2026-08-23.

- **Model is `claude-sonnet-5`** (CLAUDE.md §3 overrides SPEC.md's `claude-sonnet-4-6`).
- **`thinking: { type: "adaptive" }`.** `budget_tokens` is **removed** on Sonnet 5 — sending it is a
  400. `display` defaults to `"omitted"` on this model, which is what we want; we never surface
  reasoning.
- **`output_config: { effort }`** is nested inside `output_config`, never top-level. `"medium"` for
  message drafting, `"high"` for topic and scripture generation.
- **Structured output is `output_config.format` via `client.messages.parse()`**, not the deprecated
  top-level `output_format`. Import `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`. The
  parsed value lands on `response.parsed_output`, which is **`null` when parsing failed** — guard it,
  do not assert it. (`ai-a` only needs plain text; the helper is set up here so `ai-c` can use it.)
- **No assistant prefill.** It is a 400 on this model. Shape output with the system prompt or
  `output_config.format`.
- **`response.content` is a discriminated union.** Narrow on `block.type === "text"` before reading
  `.text`; TypeScript errors otherwise.
- **`stop_details` is populated only when `stop_reason === "refusal"`** and is `null` for every other
  stop reason. Always guard before reading `.category`.
- **Typed errors:** `Anthropic.RateLimitError`, `Anthropic.AuthenticationError`,
  `Anthropic.BadRequestError`, `Anthropic.APIConnectionError`, all extending `Anthropic.APIError`
  with a `status`. Check most specific first. Never string-match a message.
- **The SDK already retries twice** on 429/5xx/connection errors. Do not add a retry loop on top;
  by the time a `RateLimitError` reaches us the SDK has already backed off.
- **Minimum cacheable prefix is ~1024 tokens.** A ward with sparse settings will produce a stable
  prefix under that and `cache_read_input_tokens` will stay 0. That is *not* a bug and the test must
  not assert otherwise — the test asserts **breakpoint placement**, and the 1024-token floor is
  documented in a comment so nobody debugs it later.

---

## Tasks

### Task 1: Domain types

**File:** `types/domain.ts` (modify)

Append near the existing topic/prayer blocks, following the `as const` + derived-type +
`Record<T, string>`-labels pattern already used throughout the file.

```ts
export const AI_MODULES = [
  "settings_preview",
  "topic_suggestions",
  "confirmation_message",
  "thank_you_message",
] as const;
export type AiModule = (typeof AI_MODULES)[number];

export const STANDARD_WORKS = [
  "old_testament",
  "new_testament",
  "book_of_mormon",
  "doctrine_and_covenants",
  "pearl_of_great_price",
] as const;
export type StandardWork = (typeof STANDARD_WORKS)[number];

export const STANDARD_WORK_LABELS: Record<StandardWork, string> = { /* "Old Testament", … */ };

export type ScripturePreferences = {
  canonPriority: readonly StandardWork[];
  maxReferences: number;
  relevanceNotes: string | null;
};

export type ConferencePreferences = {
  maxYearsOld: number | null;
  maxTalks: number;
  preferKnowledgeBase: boolean;
};

export type AiSettings = {
  id: string;
  toneVoice: string | null;
  doctrinalEmphasis: string | null;
  scripturePreferences: ScripturePreferences | null;
  conferencePreferences: ConferencePreferences | null;
  topicPreferences: string | null;
  wardContext: string | null;
  thankYouPreferences: string | null;
  savedBy: string | null;
  createdAt: string;
};
```

`AI_MODULES` holds four entries, not six. Phase 6 adds `hymn_suggestions` and `program_edit`;
adding them now would mean two module-instruction blocks nothing calls, which read as finished
work. Leave a one-line comment saying so.

`maxYearsOld: null` means "no recency limit" and must be spelled that way in the prose renderer —
not silently treated as zero.

---

### Task 2: AI error type

**File:** `lib/ai/errors.ts` (create)

```ts
export const AI_ERROR_KINDS = [
  "not_configured",
  "rate_limited",
  "refused",
  "truncated",
  "unavailable",
  "invalid_request",
] as const;
export type AiErrorKind = (typeof AI_ERROR_KINDS)[number];

export class AiRequestError extends Error {
  readonly kind: AiErrorKind;
  readonly status: number;
  constructor(kind: AiErrorKind, message: string, cause?: unknown) { … }
}

export function isAiRequestError(error: unknown): error is AiRequestError
```

Follow `lib/auth/errors.ts` for the class + type-guard shape (a guard, not `instanceof`, so the
check survives a module-instance split).

`message` is the text the user reads. Six kinds, six distinct sentences, each naming what happened
and what to do:

| Kind | Status | Message |
|---|---|---|
| `not_configured` | 503 | `"AI is not set up yet. An administrator needs to add the Anthropic API key before this will work."` |
| `rate_limited` | 429 | `"The AI service is busy. Wait a moment and try again — nothing was lost."` |
| `refused` | 422 | `"Claude declined to answer this one. Try rewording the request."` |
| `truncated` | 422 | `"The draft was cut off before it finished. Try a shorter request."` |
| `unavailable` | 502 | `"Could not reach the AI service. Check your connection and try again."` |
| `invalid_request` | 500 | `"The AI service rejected the request. This is a bug — nothing was saved."` |

The original error travels on `cause`, never swallowed (CLAUDE.md rule 7).

---

### Task 3: Claude client

**File:** `lib/ai/client.ts` (create)

Server-only. Open with the same browser guard `lib/supabase/service.ts` uses, for the same reason —
an accidental client import must fail loudly at the boundary rather than ship a key:

```ts
if (typeof window !== "undefined") {
  throw new Error(
    "lib/ai/client.ts was imported into browser code. ANTHROPIC_API_KEY must never reach the client.",
  );
}
```

Exports:

```ts
export const MODEL = "claude-sonnet-5";

// A confirmation text message is deliberately short; 4096 is a product decision, not a guess.
export const MESSAGE_MAX_TOKENS = 4096;
// Topic batches are long. Still well under the streaming threshold.
export const GENERATION_MAX_TOKENS = 16000;

export type AiEffort = "medium" | "high";

export type CallClaudeParams = {
  system: Anthropic.TextBlockParam[];
  userPrompt: string;
  effort: AiEffort;
  maxTokens: number;
};

export type ClaudeTextResult = {
  text: string;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  inputTokens: number;
  outputTokens: number;
};

export async function callClaude(params: CallClaudeParams): Promise<ClaudeTextResult>;

export async function callClaudeStructured<T>(
  params: CallClaudeParams & { format: AutoParseableOutputFormat<T> },
): Promise<{ parsed: T } & Omit<ClaudeTextResult, "text">>;
```

**Client factory.** Lazily construct one module-level `Anthropic` instance. Read
`process.env.ANTHROPIC_API_KEY` explicitly and throw
`new AiRequestError("not_configured", …)` when it is missing or empty — the SDK's own error for an
absent key is not something a bishop can act on. Never log the key, and never include it in the
`cause`.

**Request shape:**

```ts
const response = await client.messages.create({
  model: MODEL,
  max_tokens: params.maxTokens,
  thinking: { type: "adaptive" },
  output_config: { effort: params.effort },
  system: params.system,
  messages: [{ role: "user", content: params.userPrompt }],
});
```

**Then, in this order:**

1. `if (response.stop_reason === "refusal")` → throw `AiRequestError("refused", …)`. Log
   `response.stop_details?.category` server-side; do not show the category to the user.
2. `if (response.stop_reason === "max_tokens")` → throw `AiRequestError("truncated", …)`.
   A truncated draft is worse than no draft: it looks finished.
3. Concatenate every `block.type === "text"` block. If the result is empty after trimming, throw
   `AiRequestError("invalid_request", …)` — an empty string returned as a draft is the exact silent
   failure the phase plan's pitfall list names.
4. Return the text plus the four usage counters. The counters exist so the cache pitfall is
   *observable*: `cacheReadTokens` staying 0 across identical-prefix calls is the documented symptom
   of something volatile above the breakpoint.

**Error translation** — a `catch` around the call, most specific first:

```
Anthropic.AuthenticationError  -> not_configured
Anthropic.RateLimitError       -> rate_limited
Anthropic.APIConnectionError   -> unavailable
Anthropic.BadRequestError      -> invalid_request
Anthropic.APIError             -> status >= 500 ? unavailable : invalid_request
anything else                  -> rethrow untouched
```

Rethrowing the unknown case matters: swallowing it into `invalid_request` would hide a real bug
behind a message that says "nothing was saved" without knowing whether that is true.

`callClaudeStructured` is the same function with `client.messages.parse()` and
`output_config: { effort, format }`. It additionally throws `AiRequestError("invalid_request", …)`
when `response.parsed_output` is `null`, because a null parse is a schema mismatch, not an answer.
Nothing in `ai-a` calls it — it exists so `ai-c` inherits the same error contract instead of
inventing a second one.

---

### Task 4: Module instructions

**File:** `lib/ai/moduleInstructions.ts` (create)

Pure. No imports beyond `types/domain`.

```ts
export const MODULE_INSTRUCTIONS: Record<AiModule, string> = { … };
```

Keep each block **short and specific** — three or four plain sentences. The phase plan is explicit
about why, and it is worth a comment in the file: current Claude models follow instructions closely,
and a paragraph of "CRITICAL: YOU MUST" language causes over-application. State the task and the
constraints once.

`settings_preview` is the honest one to get right. It should say the output is a sample so the
bishopric can judge tone, and that it will not be sent to anyone.

Every block whose output could cite doctrine ends with the citation instruction — "Cite the source
of any scripture or conference talk you reference, for example *Alma 32:21* or *Elder Holland, April
2024*." — which is rule 4 of the phase plan. Put that sentence in one exported constant
(`CITATION_INSTRUCTION`) and compose it in, so a later module cannot forget it by hand.

---

### Task 5: System prompt assembly

**File:** `lib/ai/systemPrompt.ts` (create)

**Pure, and takes settings as an argument** — a deliberate deviation from the phase plan's
`buildSystemPrompt({ wardId, … })`. A function that resolves its own ward needs a database to test,
and every other pure rule in this codebase (`goalStatus.ts`, `messageTemplate.ts`,
`prayerPipeline.ts`) is a function of its inputs for exactly that reason. The caller resolves
settings; this assembles them.

```ts
export type RetrievedChunk = { content: string; sourceLabel: string };

export type BuildSystemPromptInput = {
  settings: AiSettings | null;
  module: AiModule;
  retrievedChunks?: readonly RetrievedChunk[];
};

export function buildSystemPrompt(input: BuildSystemPromptInput): Anthropic.TextBlockParam[];
export function renderSettingsProse(settings: AiSettings | null): string;
```

**Returns two or three blocks, always in this order:**

| Index | Layer | `cache_control` |
|---|---|---|
| 0 | Ward AI settings, as prose | none |
| 1 | Module instructions + citation instruction | **`{ type: "ephemeral" }`** |
| 2 | Retrieved chunks with source labels — **omitted entirely when there are none** | none |

Block 0 is present even when `settings` is `null`, rendering a single sentence
(`"This ward has not saved any AI preferences yet. Use plain, warm, straightforward language."`).
Keeping the block count stable for the first two layers keeps the prefix shape constant and makes
the breakpoint assertion a simple index check rather than a search.

**The breakpoint is on the LAST stable block, and layer 3 comes after it.** This is the single
most consequential line in the file and deserves the comment: retrieved chunks vary per request, so
anything cached after them never hits. Stable first, volatile last, always.

`renderSettingsProse` renders **prose, not JSON**. Skip any field that is null or blank rather than
emitting `"Tone: null"`. Spell `maxYearsOld: null` as "any year" and `maxReferences: 0` as "do not
suggest scriptures" — a zero that renders as "0 references" reads like a formatting bug.

Layer 3 formats each chunk as a labelled excerpt (`[Alma 32] …`) and closes with the reminder that
these are excerpts, not whole documents. `ai-b` supplies the chunks; `ai-a` ships the branch with an
empty list and a test that covers both sides of it.

---

### Task 6: Validation schemas

**File:** `lib/validation/aiSettings.ts` (create)

Follow `lib/validation/goal.ts` for shape and for message tone — every message is a sentence a
person could act on, because `respondToRouteError` surfaces `error.issues[0].message` verbatim.

- `scripturePreferencesSchema` — `canonPriority` an array of `STANDARD_WORKS` values with no
  duplicates; `maxReferences` an int 0–10; `relevanceNotes` nullable, max 500.
- `conferencePreferencesSchema` — `maxYearsOld` nullable int 1–50; `maxTalks` int 0–10;
  `preferKnowledgeBase` boolean.
- `aiSettingsInputSchema` — the five free-text fields nullable with a max length (2000 for
  `wardContext`, 1000 for the rest) plus the two preference objects, nullable.
- `previewRequestSchema` — `{ settings: aiSettingsInputSchema, prompt: string 1–1000 }`.

Export the inferred types. The form imports these schemas too — same schema on both sides of the
boundary, per CLAUDE.md §6.

---

### Task 7: Settings queries

**File:** `lib/ai/queries.ts` (create)

Server-only, one module for every `ai_settings` read and write (conventions.md §Data Access).

```ts
export async function getActiveAiSettings(wardId, client?): Promise<AiSettings | null>;
export async function listAiSettingsVersions(wardId, client?): Promise<AiSettingsVersion[]>;
export async function getAiSettingsVersion(wardId, id, client?): Promise<AiSettings | null>;
export async function insertAiSettingsVersion(wardId, savedBy, input, client?): Promise<AiSettings>;
```

`AiSettingsVersion = AiSettings & { savedByName: string | null }`.

**Four things to get right:**

1. **Active = latest.** `.order("created_at", { ascending: false }).order("id", { ascending: false })
   .limit(1).maybeSingle()`. The `id` tie-break is load-bearing on an append-only table where two
   saves can share a second.
2. **`insertAiSettingsVersion` only ever INSERTs.** There is no update function and no delete
   function in this module, and that absence is the versioning guarantee — not a rule somebody has to
   remember. Say so in a comment.
3. **Resolve saver names with a second query, not a PostgREST embedded join.** `ai_settings`'
   foreign key to `users` is composite (`saved_by, ward_id`), and embedded-join syntax over a
   composite FK is fragile and depends on a generated constraint name. Select the distinct
   `saved_by` ids, read `users(id, first_name, last_name)` in one `.in()` query, and map in
   TypeScript. `users` has a ward-scoped SELECT policy from migration 020, so this is allowed.
4. **Map the jsonb columns through the Zod schemas on read.** `scripture_preferences` is `Json` in
   `types/database.ts`; parse it with `scripturePreferencesSchema.safeParse()` and fall back to
   `null` on failure rather than casting. A row written before a schema change must not crash the
   page.

---

### Task 8: `/api/ai-settings` — GET and POST

**File:** `app/api/ai-settings/route.ts` (create)

Copy the structure of `app/api/topic-candidates/route.ts` exactly: resolve the session **outside**
the try (because `requireSessionUser` redirects by throwing), then `createServerSupabaseClient` →
`resolveRoleAccess` → `assertCan` inside it, and end with `respondToRouteError`.

- **GET** — `assertCan(user, "ai_settings.view", roleAccess)`. Returns `{ settings }`, `null` when
  the ward has never saved.
- **POST** — `assertCan(user, "ai_settings.manage", roleAccess)`. Parse with
  `aiSettingsInputSchema`, insert a new version, then:
  - `writeAuditLog({ action: "ai_settings_saved", module: "ai", detail: { settingsId } })`
  - `notifyOtherBishopric({ description: "AI settings were updated.", title: "AI settings changed" })`
    — FEATURES.md §Module 15 and CLAUDE.md §7 both require it, and the phase plan names
    `admin_setting_changed` as the trigger, which is exactly what `notifyOtherBishopric` emits.

  Returns `{ settings }` with 200.

---

### Task 9: `/api/ai-settings/history` — GET

**File:** `app/api/ai-settings/history/route.ts` (create)

`ai_settings.view`. Returns `{ versions }`, newest first, each carrying `savedByName` and
`createdAt`. No pagination — a ward saves these a handful of times a year.

---

### Task 10: `/api/ai-settings/restore/[id]` — POST

**File:** `app/api/ai-settings/restore/[id]/route.ts` (create)

`ai_settings.manage`. **`params` is a Promise in Next 16:**
`export async function POST(request: Request, { params }: { params: Promise<{ id: string }> })`.

1. `getAiSettingsVersion(wardId, id)`. Missing → 404 with
   `"That version is not in your ward."` (never leak whether it exists elsewhere).
2. `insertAiSettingsVersion` copying every field forward, `savedBy` = the current user.
   **Restore creates a new version; it never deletes the ones after it.** Comment that inline —
   it is the whole reason the endpoint exists rather than a DELETE.
3. Audit `ai_settings_restored` with `{ settingsId, restoredFromId }`, then `notifyOtherBishopric`.

Returns `{ settings }` — the *new* row, not the one that was restored from.

---

### Task 11: `/api/ai-settings/preview` — POST

**File:** `app/api/ai-settings/preview/route.ts` (create)

The feature the panel exists for. **It accepts draft settings in the request body and writes
nothing.**

- `assertCan(user, "ai_settings.manage", roleAccess)` — not `view`. A preview spends money and sends
  ward text to a third-party vendor; that is the authority to change settings, not to read them.
- Body: `previewRequestSchema`. The draft is shaped into an `AiSettings`-like object **in memory
  only** — give it a sentinel `id` of `"draft"` and `createdAt` of `""` so nothing can mistake it for
  a row.
- `buildSystemPrompt({ settings: draft, module: "settings_preview" })` — no `retrievedChunks`, so
  layer 3 is absent. `ai-b` is where a preview starts retrieving.
- `callClaude({ system, userPrompt: input.prompt, effort: "medium", maxTokens: MESSAGE_MAX_TOKENS })`.
- Returns `{ draft: text, usage: { cacheReadTokens, inputTokens, outputTokens } }`. Surfacing usage
  is deliberate: it is the only place a human can see the cache working.
- **Audit it** — `action: "ai_preview_run"`, `module: "ai"`, `detail: { promptLength, outputTokens }`.
  Never log the prompt text or the output. Rule 6 is about mutations, and this mutates nothing; it is
  logged anyway because it is an outbound call to a vendor on the ward's behalf, and a spend with no
  record is not something an audit log should be silent about.
- **No `try`/`catch` around `callClaude` here.** Let `AiRequestError` reach `respondToRouteError`,
  which Task 12 teaches to map it. Catching it locally is how the "silent AI failure" pitfall starts.

**This route must not touch `ai_settings`.** No select, no insert. The `no-autosave` test asserts it
structurally.

---

### Task 12: Route error mapping

**File:** `lib/auth/routeErrors.ts` (modify)

Add one branch, above the `ZodError` branch and below `isForbiddenError`:

```ts
if (isAiRequestError(error)) {
  console.error(`AI request failed in ${context.route} — ${error.kind}`, {
    ...context.detail,
    cause: error.cause,
  });
  return NextResponse.json({ error: error.message }, { status: error.status });
}
```

It logs *and* returns, because an AI failure is both a user-facing event and something worth having
in the server log with its `cause` attached. Nothing else in this file changes.

---

### Task 13: The page

**File:** `app/(app)/ai-settings/page.tsx` (create)

Server Component, following `app/(app)/talks/topics/page.tsx` line for line:

```ts
const user = await requireSessionUser();
const supabase = await createServerSupabaseClient();
const roleAccess = await resolveRoleAccess(supabase, user.wardId);

if (!can(user, "ai_settings.view", roleAccess)) {
  return <NotPermitted detail="AI settings are limited to the bishopric." />;
}

const canManage = can(user, "ai_settings.manage", roleAccess);
const [settings, versions] = await Promise.all([...]);
```

`can()`, not `assertCan()` — a `ForbiddenError` out of a Server Component is a 500 with a stripped
message.

Heading, one line of explanation ("These settings shape every draft the app generates. Nothing here
is sent to anyone — every draft is still yours to read and approve."), then the three client
components.

---

### Task 14: The form

**File:** `app/(app)/ai-settings/AiSettingsForm.tsx` (create)

`"use client"`. Seven `<Card>` sections in FEATURES.md §Module 6's order: Tone & Voice · Doctrinal
Emphasis · Scripture Preferences · Conference Talk Preferences · Topic Generation Preferences ·
Ward Context · Thank You Preferences.

- Five are textareas; two are structured (canon priority as an ordered multi-select or an
  up/down-ordered checkbox list, plus number inputs and a checkbox).
- **Every field needs a distinct `id`** — seven sections on one page, and `Input` requires one.
  Prefix them (`ai-tone`, `ai-scripture-max`, …).
- Validate with `aiSettingsInputSchema` before POSTing — same schema as the route.
- `canManage === false` renders everything read-only with no Save button. Not a *disabled* Save
  button: talks-b's rule is that a disabled control reads as "this is coming".
- On success, refresh via `useRouter().refresh()` so history picks up the new version.
- Errors through `<FormError />`.

**It holds the current form state and hands it to `PreviewPanel`** — the panel previews what is on
screen, not what is in the database. Lift the state here, or share it through one parent.

---

### Task 15: The preview panel

**File:** `app/(app)/ai-settings/PreviewPanel.tsx` (create)

`"use client"`. A prompt textarea, a Preview button, and an output area.

- POSTs `{ settings: <current unsaved form state>, prompt }` to `/api/ai-settings/preview`.
- Output renders as plain text in a bordered block, clearly labelled as a sample. Never styled to
  look like a finished, sendable message.
- On a non-2xx, show `body.error` verbatim through `<FormError />` — the six messages from Task 2 are
  already written for a human, and re-wording them here would collapse six distinguishable failures
  back into one.
- Below the output, a muted line reporting cache read tokens and output tokens.
- A muted note near the button: **"This runs against what is on screen, including changes you have
  not saved."** That is the whole feature; say it.

---

### Task 16: Version history

**File:** `app/(app)/ai-settings/VersionHistory.tsx` (create)

`"use client"`. Newest first, each row "Saved by Sister Chen on 12 August 2026", the current one
badged "Active".

- Restore button per row, hidden entirely when `canManage` is false.
- A confirm step before POSTing, worded **by consequence** the way calendar-b's 409 dialog is:
  "Restoring makes this the active configuration. Your current settings stay in the history — nothing
  is deleted."
- Format `timestamptz` with `Intl.DateTimeFormat` and `timeZone: "UTC"`, matching
  `formatStamp` in `ContactStagePanel.tsx`. Never round-trip through local time.

---

## Testing Strategy

| File | Kind | Asserts |
|---|---|---|
| `tests/lib/aiClientKeys.test.ts` | source scan | Phase 5 test **no-client-keys** |
| `tests/lib/systemPrompt.test.ts` | pure | Phase 5 test **system-prompt** |
| `tests/lib/aiErrorHandling.test.ts` | unit, mocked SDK | Phase 5 test **ai-error-handling** |
| `tests/lib/aiSettingsValidation.test.ts` | pure | Zod boundaries |
| `tests/routes/ai-settings.test.ts` | route, real RLS | Phase 5 test **settings-versioning** + **no-autosave** |
| `tests/rls/ai-settings-access.test.ts` | RLS | ward and role isolation |

**`aiClientKeys.test.ts`** — read the repo's own source with `fs` and `fast-glob`-free recursion over
`app/`, `components/`, `lib/`, `types/`:
- no file anywhere contains `NEXT_PUBLIC_ANTHROPIC` or `NEXT_PUBLIC_OPENAI`;
- no file carrying a `"use client"` directive imports `@/lib/ai/client` or `@/lib/ai/queries`
  (transitively — follow one level of `@/lib/ai/*` imports);
- `lib/ai/client.ts` contains the `typeof window` guard.
This is a source-level test on purpose. A runtime test can only prove the paths it happens to
execute.

**`systemPrompt.test.ts`** — the important one:
- three layers appear in order when chunks are supplied;
- **`cache_control` is set on exactly one block, and its index is less than the index of the chunks
  block** — the phase plan's stated assertion;
- with no chunks, exactly two blocks are returned and the last one carries the breakpoint;
- with `settings === null`, block 0 still exists and no block contains the string `"null"`;
- `maxYearsOld: null` renders as words, not as "null"; `maxReferences: 0` renders as a refusal to
  suggest, not as "0";
- every module's block ends with the citation instruction.

**`aiErrorHandling.test.ts`** — `vi.mock("@anthropic-ai/sdk")` and drive `messages.create` to throw
each SDK error class, then to resolve with `stop_reason: "refusal"`, `"max_tokens"`, and an empty
text block. Assert **six distinct `kind` values and six distinct messages** — assert the set has
size six, so a future copy-paste that duplicates a message fails here. Also assert an unknown error
is rethrown unchanged rather than becoming `invalid_request`.

**`ai-settings.test.ts`** — `// @vitest-environment node`, the `vi.mock` block from CLAUDE.md §8,
`seedFixtures` / `fixtures.cleanup()`:
- bishop saves twice → history has two rows, both readable, the second is active;
- counselor restores version 1 → history has **three** rows and the newest matches version 1's
  content (this is the "history is never destroyed" assertion);
- restore of an id from another ward → 404, and re-read with the service client proves nothing was
  inserted;
- `ward_secretary` gets 403 on GET, POST, and preview — check the matrix first, but
  `ai_settings.*` is bishopric-only, so all three refuse;
- **no-autosave:** stub `@/lib/ai/client` so `callClaude` resolves a fixed string, count
  `ai_settings` rows for the ward with the service client before and after a preview, assert equal.
  Then assert the same for a preview that *throws* `AiRequestError`.

**`ai-settings-access.test.ts`** — the standard RLS shape: a ward-A bishop cannot select or insert
ward B's `ai_settings`; an `org_president` in ward A cannot select ward A's. Remember
**foundation-c's rule** — an RLS-denied UPDATE or DELETE is a zero-row success, not an error, so
re-read with the service client to prove refusal. Seed and clean up; the hosted project is shared.

---

## Test Scenarios (Harness)

### Scenario 020: Preview before you save

**Tags:** `ai`, `full`, `settings`
**Purpose:** The preview panel's entire value is running against *unsaved* settings, and no
automated test can judge whether the tone the bishopric asked for is the tone that came back. Seeding
gives a ward with a saved baseline version so "the draft changed when I changed the tone" is a real
comparison rather than a first impression.

**Seed data summary**
- `wards` — 1
- `users` — bishop, counselor, ward_secretary
- `ai_settings` — 2 versions, saved by different people on different dates, deliberately plain in
  tone so an edit is visibly different

**Tester action:** Sign in as the bishop, open `/ai-settings`, read the loaded values, change Tone &
Voice to something distinctive ("warm and brief, never formal"), and click Preview **without
saving**. Then reload the page.

**Verification checklist**
- [ ] The form loads the *newest* of the two seeded versions, not the older one
- [ ] Preview returns real text that reflects the unsaved tone change
- [ ] After reload, Tone & Voice shows the **seeded** value again — preview saved nothing
- [ ] History lists both seeded versions with the correct names and dates, newest first, and only
      the newest is badged Active
- [ ] Restoring the older version adds a **third** row rather than removing the second
- [ ] The token line under the output shows a non-zero output-token count
- [ ] Signed in as `ward_secretary`, `/ai-settings` shows "Not permitted" — not an empty form
- [ ] Works at 375px and in both light and dark mode

### Scenario 021: The AI is unreachable

**Tags:** `ai`, `full`, `failure`
**Purpose:** The phase plan's most important pitfall is silent AI failure, and the only way to see
what a bishop actually sees is to break the key and look. Cannot be seeded — it is an environment
manipulation, which is why it is a scenario and not a test.

**Seed data summary** — reuse scenario 020's seed.

**Tester action:** Stop the dev server, set `ANTHROPIC_API_KEY` to an obviously invalid value,
restart, and click Preview. Then unset it entirely, restart, and click Preview again.

**Verification checklist**
- [ ] An invalid key produces the *not configured* message naming the API key — not a spinner that
      never resolves, and not an empty output box
- [ ] An absent key produces the same message, reached before any network call
- [ ] The output area stays empty rather than showing a blank "draft"
- [ ] The error is dismissible and Preview can be clicked again
- [ ] Nothing was written to `ai_settings` (check history)

---

## Validation Commands

Run in this order. Fix and re-run on any failure; do not skip.

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run build` is not optional. Static generation runs code the dev server never does, and
`/ai-settings` is a new route in the `(app)` group.

---

## Integration Notes

- **No migration.** `ai_settings` (migration 014) and its bishopric-only RLS (migration 019) already
  exist. If a task seems to need a schema change, stop — it is out of scope for this plan.
- **`NAVIGATION_ITEMS` is unchanged.** The AI Settings link already exists and currently 404s; this
  plan makes it resolve. Do not add a second entry.
- **Nothing here is called by any other feature yet.** `callClaude` has exactly one caller — the
  preview route. `ai-c` adds the rest. That is deliberate: the client is proven through a surface a
  human can see before anything depends on it.
- **Handed to `ai-b`:** `buildSystemPrompt`'s `retrievedChunks` parameter and the layer-3 branch ship
  here, tested with an empty list. `ai-b` supplies real chunks and changes no signature.
- **Handed to `ai-c`:** `callClaudeStructured` and `AI_MODULES`' three unused entries.
  `MODULE_INSTRUCTIONS` already holds a block for each.
- **Documentation:** update SPEC.md §API Routes to mark the five `/api/ai-settings` routes built, and
  SPEC.md §AI Integration to record that `buildSystemPrompt` is pure and takes resolved settings. If
  the spec and the code disagree, CLAUDE.md §1 says flag it and fix the spec in the same change.
- **Breaking changes:** none. Every modified file gains behaviour; nothing existing changes shape.
