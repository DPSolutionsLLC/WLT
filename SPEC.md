# Ward Leadership Tools (WLT)
### Technical Specification

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14+ (App Router) |
| Hosting | Vercel |
| Database | Supabase (Postgres) |
| Auth | Supabase Auth |
| Realtime | Supabase Realtime |
| File Storage | Supabase Storage |
| Vector Search | Supabase pgvector |
| AI | Claude API (`claude-sonnet-5`) — adaptive thinking, effort inside `output_config` |
| PDF Generation | `@react-pdf/renderer` or `puppeteer` (server-side) |
| Email | Resend (for agenda and program PDF distribution) |
| Styling | Tailwind CSS with dark mode support (`dark:` variant) |
| State | React Context + SWR or TanStack Query |

---

## Multi-Ward Architecture

Every table includes a `ward_id` foreign key. All queries are scoped to the active ward. Auth tokens carry the user's `ward_id` in their JWT claims. This enables future multi-ward support without schema changes.

---

## Database Schema

### `wards`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
name            text NOT NULL
created_at      timestamptz DEFAULT now()
settings        jsonb  -- ward-level configuration (see Ward Settings)
```

### `organizations`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
name            text NOT NULL  -- 'Bishopric', 'Elders Quorum', etc.
type            text NOT NULL  -- 'bishopric' | 'elders_quorum' | 'relief_society' | 'young_men' | 'young_women' | 'primary' | 'sunday_school' | 'other'
is_active       boolean DEFAULT true
created_at      timestamptz DEFAULT now()
```

### `users`
```sql
id              uuid PRIMARY KEY REFERENCES auth.users(id)
ward_id         uuid NOT NULL REFERENCES wards(id)
first_name      text
last_name       text
email           text
username        text   -- youth PIN accounts only; unique per ward, case-insensitive
-- No pin_hash column. Migration 021 dropped it: the PIN is the password on a synthetic
-- Supabase Auth account ({username}@youth.{ward-uuid}.invalid), so Supabase owns the hashing
-- and there is exactly one credential store. See plans/retros/auth-c-youth-pin.md.
role            text  -- 'bishop' | 'counselor' | 'ward_secretary' | 'executive_secretary' | 'org_president' | 'org_counselor' | 'org_secretary' | 'music_coordinator' | 'ward_council_member' | 'sacrament_manager'
org_id          uuid REFERENCES organizations(id)  -- null for bishopric/ward-level roles
counselor_position  integer  -- 1 or 2 for counselors; null otherwise
is_active       boolean DEFAULT true
theme_preference    text DEFAULT 'system'  -- 'light' | 'dark' | 'system'
created_at      timestamptz DEFAULT now()
```

### `invites`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
email           text
role            text
org_id          uuid REFERENCES organizations(id)
counselor_position  integer
invited_by      uuid REFERENCES users(id)
token           text UNIQUE NOT NULL
expires_at      timestamptz
used_at         timestamptz
created_at      timestamptz DEFAULT now()
```

### `youth_login_attempts`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid NOT NULL REFERENCES wards(id)
username        text NOT NULL   -- lower-cased; keyed by username, not user id, so an attempt
                                -- against an unknown username is still counted
failed_count    integer NOT NULL DEFAULT 0
locked_until    timestamptz     -- five consecutive failures locks for 15 minutes
last_failed_at  timestamptz
created_at      timestamptz DEFAULT now()
UNIQUE (ward_id, username)
```
RLS enabled with **no policies**: only the PIN login route touches it, and that route runs with
the service-role client because its caller is unauthenticated by definition. Never stores a PIN.

### `households`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
family_name     text NOT NULL
address         text
latitude        numeric
longitude       numeric
created_at      timestamptz DEFAULT now()
```

### `members`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
household_id    uuid REFERENCES households(id)
first_name      text NOT NULL
last_name       text NOT NULL
category        text  -- 'adult' | 'youth' | 'child'
gender          text  -- 'male' | 'female'
status          text DEFAULT 'active'  -- 'active' | 'moved_out' | 'do_not_contact'
phone           text
created_at      timestamptz DEFAULT now()
-- No `notes` column. Member notes are bishopric-only, and RLS grants or denies a row,
-- never a column — so they live in `member_notes` below, behind their own policy.
```

### `member_notes`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid NOT NULL REFERENCES wards(id)
member_id       uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE
body            text NOT NULL
created_by      uuid REFERENCES users(id)
created_at      timestamptz DEFAULT now()
updated_at      timestamptz DEFAULT now()
-- RLS: is_bishopric() AND ward_id = current_ward_id(), on every operation
```

### `member_organizations`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid NOT NULL REFERENCES wards(id)
member_id       uuid REFERENCES members(id)
org_id          uuid REFERENCES organizations(id)
-- Links members to their organizations for filtered roster views
```

### `sundays`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
date            date NOT NULL  -- UNIQUE (ward_id, date), not UNIQUE alone
type            text DEFAULT 'standard'  -- 'standard' | 'fast_sunday' | 'stake_conference' | 'general_conference' | 'holiday' | 'special'
notes           text
conducting_user_id  uuid REFERENCES users(id)
speaking_slots  integer DEFAULT 3
slot_config     jsonb  -- array of {slot_number, length_minutes, type}
presiding_override  text  -- if not the bishop, free text name/title
created_at      timestamptz DEFAULT now()
```

### `conducting_rotation`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
position        integer  -- 1=Bishop, 2=1st Counselor, 3=2nd Counselor
user_id         uuid REFERENCES users(id)
effective_from  date
created_at      timestamptz DEFAULT now()
```

### `topics`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
title           text NOT NULL
category        text  -- 'doctrinal' | 'scriptural' | 'conference_talk' | 'seasonal' | 'custom'
description     text
suggested_scriptures    jsonb  -- array of strings, e.g. ["Alma 32:21"]. See the note below
suggested_talks         jsonb  -- array of strings, e.g. ["Ministering — April 2018"]
source          text  -- 'ai_generated' | 'manual' | 'library'
status          text DEFAULT 'active'  -- 'active' | 'archived'
last_assigned_at    timestamptz
created_at      timestamptz DEFAULT now()
```

**The two jsonb columns are arrays of plain strings**, not the objects sketched above. talks-c
settled it that way because nothing in the app produces a `relevance_note` or a `url`, and giving
either column a richer shape now would be guessing at what Phase 5 emits. `lib/validation/topic.ts`
validates the shape on write for the reason `calendar-a` gives about `slot_config`: nothing
validates a jsonb blob on read, and Phase 6 reads these directly to build the printed program, so
a malformed entry stored today breaks a PDF months from now, far from the boundary that accepted
it. If Phase 5 needs a richer shape, it changes the Zod schema and migrates the existing rows —
it does not start writing a second shape into the same column.

**There is no delete route for a topic.** Archiving is how a topic leaves the library, because a
topic referenced by an assignment must not vanish from that assignment's history.

**`last_assigned_at` is stamped at `approve`, and at no other stage.** Not at `plan` — a plan that
never gets approved should not burn the topic. Not at `complete` — the bishopric needs the signal
while they are still choosing, which is weeks before the talk is given. A backward move does NOT
un-stamp it: the topic genuinely was chosen for a Sunday, and rolling the stamp back would
re-offer something they had just discussed. `tests/db/topic-last-assigned.test.ts` pins all three.

### `topic_candidates`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
title           text NOT NULL
category        text  -- same five as topics.category
description     text
suggested_scriptures    jsonb  -- array of strings
suggested_talks         jsonb  -- array of strings
status          text DEFAULT 'pending'  -- 'pending' | 'accepted' | 'rejected'
accepted_topic_id   uuid REFERENCES topics(id)
reviewed_by     uuid REFERENCES users(id)
reviewed_at     timestamptz
created_at      timestamptz DEFAULT now()
```

Added by migration 028 (talks-c). **This table exists so there is nowhere for an AI-generated
topic to land except a queue a person reviews** (CLAUDE.md rule 3). Phase 5 writes `pending` rows
here and never inserts into `topics`; if a Phase 5 plan proposes otherwise, that is the rule-3
violation this table exists to make impossible.

BISHOPRIC-ONLY under its own four policies — it is not in migration 019's ward-wide loop.
`topic_candidates_review_pair` refuses a reviewed row with no reviewer, so an accept is always
attributable to a person and a moment.

Accept and reject are **per candidate**. There is no array in the schema and no "accept all": a
bulk accept is an auto-add wearing a button.

### `assignments`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
sunday_id       uuid REFERENCES sundays(id)
member_id       uuid REFERENCES members(id)
external_speaker_name   text  -- ITER-004: a speaker who is not on the ward roster
external_speaker_title  text  -- an honorific the planner TYPED, e.g. 'President'. Never derived
assignment_type text  -- 'sacrament_talk' | 'organizational' | 'returning_missionary' | 'new_member' | 'youth_speaker' | 'high_council' | 'other'
counts_toward_rotation  boolean DEFAULT true
topic_id        uuid REFERENCES topics(id)
slot_number     integer
slot_length_minutes integer
pipeline_stage  text DEFAULT 'plan'  -- 'plan'|'review'|'approve'|'request'|'confirm'|'notify'|'speak'|'appreciate'|'complete'
planned_by      uuid REFERENCES users(id)
plan_submitted_at   timestamptz
approved_at     timestamptz
requested_at    timestamptz
requested_by    uuid REFERENCES users(id)
request_outcome text  -- 'accepted' | 'declined' | 'pending'
request_notes   text
confirmed_at    timestamptz
notify_message  text  -- approved outgoing message text
notify_sent_at  timestamptz
notify_sent_by  uuid REFERENCES users(id)
sunday_confirmed_at timestamptz
thank_you_message   text
thank_you_sent_at   timestamptz
thank_you_sent_by   uuid REFERENCES users(id)
completed_at    timestamptz
contact_waived_at   timestamptz  -- the REQUEST/CONFIRM/NOTIFY/APPRECIATE stages waived for an external speaker
contact_waived_by   uuid REFERENCES users(id)
created_at      timestamptz DEFAULT now()

-- CHECK assignments_speaker_exactly_one: a member, OR an external name, OR neither (an
--   unfilled slot). Never both (migration 025).
-- CHECK assignments_waiver_external_only: contact_waived_at only when member_id is null.
--   Waiving the contact stages for somebody on the roster would hide a real outstanding task.
-- CHECK assignments_waiver_pair: both waiver columns move together or neither does.
```

### `assignment_approvals`
UNIQUE (assignment_id, user_id) — migration 025. The APPROVE gate counts rows and calls them
people; this constraint is what makes that true. Without it one counselor can insert three rows
and satisfy a 3-of-3 gate alone.
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid NOT NULL REFERENCES wards(id)
assignment_id   uuid REFERENCES assignments(id)
user_id         uuid REFERENCES users(id)
approved        boolean
comment         text
created_at      timestamptz DEFAULT now()
```

### `assignment_comments`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid NOT NULL REFERENCES wards(id)
assignment_id   uuid REFERENCES assignments(id)
sunday_id       uuid REFERENCES sundays(id)  -- for month-level comments
user_id         uuid REFERENCES users(id)
comment         text NOT NULL
level           text  -- 'month' | 'assignment'
created_at      timestamptz DEFAULT now()
```

### `assignment_history`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid NOT NULL REFERENCES wards(id)
member_id       uuid REFERENCES members(id)
assignment_id   uuid REFERENCES assignments(id)
outcome         text  -- 'accepted' | 'declined' | 'cancelled' | 'completed'
cancellation_days_notice    integer
notes           text
created_at      timestamptz DEFAULT now()
```

### `prayer_assignments`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
sunday_id       uuid REFERENCES sundays(id)
member_id       uuid REFERENCES members(id)
prayer_type     text  -- 'invocation' | 'benediction'
stage           text DEFAULT 'assign'  -- 'assign' | 'ask' | 'confirm' | 'done'
asked_by        uuid REFERENCES users(id)
asked_at        timestamptz
confirmed_at    timestamptz
created_at      timestamptz DEFAULT now()
```

### `hymn_selections`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
sunday_id       uuid REFERENCES sundays(id)
hymn_type       text  -- 'opening' | 'sacrament' | 'closing'
hymn_number     integer
hymn_title      text
selected_by     uuid REFERENCES users(id)
ai_suggested    boolean DEFAULT false
created_at      timestamptz DEFAULT now()
```

### `musical_numbers`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
sunday_id       uuid REFERENCES sundays(id)
performer       text
piece_title     text
notes           text
created_at      timestamptz DEFAULT now()
```

### `hymns` (static reference table)
```sql
id              integer PRIMARY KEY
number          integer NOT NULL
title           text NOT NULL
topic_tags      text[]  -- for AI suggestion matching
```

### `programs`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
sunday_id       uuid REFERENCES sundays(id)
draft_data      jsonb  -- full program content snapshot (NEVER public)
public_data     jsonb  -- the safe projection; the only part anon can read. See Public Pages
pdf_url         text   -- Supabase Storage URL
status          text DEFAULT 'draft'  -- 'draft' | 'pending_approval' | 'approved' | 'distributed'
created_by      uuid REFERENCES users(id)
approved_by     uuid REFERENCES users(id)
approved_at     timestamptz
distributed_at  timestamptz
distributed_by  uuid REFERENCES users(id)
created_at      timestamptz DEFAULT now()
```

### `visit_goals`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
org_id          uuid REFERENCES organizations(id)
title           text
target_type     text  -- 'all_households' | 'specific_households' | 'custom'
cadence         text  -- 'annual' | 'biannual' | 'custom'
cadence_months  integer  -- if custom
goal_period_start   date
goal_period_end     date
created_by      uuid REFERENCES users(id)
created_at      timestamptz DEFAULT now()
```

### `visit_logs`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
org_id          uuid REFERENCES organizations(id)
household_id    uuid REFERENCES households(id)
visited_by      uuid REFERENCES users(id)
visit_date      date NOT NULL
shared_notes    text  -- visible per cross-org visibility settings
flagged_for_ward_council    boolean DEFAULT false
flag_sent_at    timestamptz
created_at      timestamptz DEFAULT now()
```

### `visit_private_notes`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid NOT NULL REFERENCES wards(id)
visit_log_id    uuid REFERENCES visit_logs(id)
user_id         uuid REFERENCES users(id)
notes           text NOT NULL
created_at      timestamptz DEFAULT now()
-- RLS: user_id = auth.uid() only
```

### `report_read_status`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid NOT NULL REFERENCES wards(id)
user_id         uuid REFERENCES users(id)
report_type     text  -- 'visit_log' | 'youth_activity'
report_id       uuid  -- references visit_logs.id or activity_logs.id
read_at         timestamptz
flagged         boolean DEFAULT false
```

### `youth_activity_profiles`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
member_id       uuid REFERENCES members(id)
activity_name   text NOT NULL
school_org      text
activity_type   text  -- 'sport' | 'performance' | 'academic' | 'community' | 'other'
season_schedule text
notes           text
entered_by      uuid REFERENCES users(id)
created_at      timestamptz DEFAULT now()
```

### `activity_calendars`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
profile_id      uuid REFERENCES youth_activity_profiles(id)
source_type     text  -- 'ics_upload' | 'google_sync' | 'manual'
source_url      text  -- for google_sync
last_synced_at  timestamptz
created_at      timestamptz DEFAULT now()
```

### `activity_events`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
calendar_id     uuid REFERENCES activity_calendars(id)
profile_id      uuid REFERENCES youth_activity_profiles(id)
title           text
event_type      text  -- 'home' | 'away' | 'tbd'
event_date      timestamptz
location        text
status          text DEFAULT 'upcoming'  -- 'upcoming' | 'covered' | 'uncovered' | 'completed'
created_at      timestamptz DEFAULT now()
```

### `activity_attendees`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid NOT NULL REFERENCES wards(id)
event_id        uuid REFERENCES activity_events(id)
user_id         uuid REFERENCES users(id)
assigned_by     uuid REFERENCES users(id)  -- null if self-added
confirmed_attendance    boolean
created_at      timestamptz DEFAULT now()
```

### `activity_logs`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
event_id        uuid REFERENCES activity_events(id)
logged_by       uuid REFERENCES users(id)
shared_notes    text
flagged_for_ward_council    boolean DEFAULT false
flag_sent_at    timestamptz
created_at      timestamptz DEFAULT now()
```

### `activity_private_notes`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid NOT NULL REFERENCES wards(id)
activity_log_id uuid REFERENCES activity_logs(id)
user_id         uuid REFERENCES users(id)
notes           text NOT NULL
created_at      timestamptz DEFAULT now()
-- RLS: user_id = auth.uid() only
```

### `goals`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
org_id          uuid REFERENCES organizations(id)  -- NULL = ward-level, bishopric-only
title           text NOT NULL
target_type     text  -- 'member' | 'household' | 'org' | 'group'
target_id       uuid  -- polymorphic reference
desired_frequency_months    integer
last_fulfilled_at   timestamptz
status          text  -- 'on_track' | 'due_soon' | 'overdue'
notes           text
created_at      timestamptz DEFAULT now()
```
`org_id` was added in migration 030 and carries the access rule: NULL is a ward-level goal only the
bishopric sees, a set value is that organization's leadership plus the bishopric. It is the same
org-scoped shape `visit_goals` has had since migration 019. `org_id` says who OWNS the goal;
`target_type`/`target_id` say what it is ABOUT, and the two are independent.

### `tithing_sessions`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
session_date    date NOT NULL
created_by      uuid REFERENCES users(id)
auto_clear_at   timestamptz  -- first entry's created_at + 48h; NULL until the first entry
created_at      timestamptz DEFAULT now()
```

### `tithing_entries`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid NOT NULL REFERENCES wards(id)
session_id      uuid REFERENCES tithing_sessions(id)
entry_number    integer NOT NULL  -- auto-incremented within session
checks          jsonb  -- array of {check_number, amount}; amount is INTEGER CENTS
bills_100       integer DEFAULT 0
bills_50        integer DEFAULT 0
bills_20        integer DEFAULT 0
bills_10        integer DEFAULT 0
bills_5         integer DEFAULT 0
bills_2         integer DEFAULT 0
bills_1         integer DEFAULT 0
coins_dollar    integer DEFAULT 0
coins_half      integer DEFAULT 0
coins_quarter   integer DEFAULT 0
coins_dime      integer DEFAULT 0
coins_nickel    integer DEFAULT 0
coins_penny     integer DEFAULT 0
created_at      timestamptz DEFAULT now()
-- No personal information stored; no relation to members table
```

### `agendas`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
meeting_type    text  -- 'bishopric' | 'ward_council'
meeting_date    date NOT NULL
sections        jsonb  -- ordered array of {title, items[], carry_forward}
status          text DEFAULT 'draft'  -- 'draft' | 'published'
published_at    timestamptz
published_by    uuid REFERENCES users(id)
pdf_url         text
created_at      timestamptz DEFAULT now()
```

### `action_items`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
agenda_id       uuid REFERENCES agendas(id)
description     text NOT NULL
assigned_to     text
due_date        date
status          text DEFAULT 'open'  -- 'open' | 'complete'
carried_from_agenda_id  uuid REFERENCES agendas(id)
completed_at    timestamptz
created_at      timestamptz DEFAULT now()
```

### `notifications`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
recipient_user_id   uuid REFERENCES users(id)
trigger_key     text  -- e.g. 'plan_submitted' | 'assignment_declined' | 'visit_flagged'
title           text
body            text
read_at         timestamptz
created_at      timestamptz DEFAULT now()
```

### `notification_settings`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
trigger_key     text NOT NULL
default_roles   text[]  -- roles that receive this by default
is_globally_enabled boolean DEFAULT true
created_at      timestamptz DEFAULT now()
```

### `notification_user_prefs`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid NOT NULL REFERENCES wards(id)
user_id         uuid REFERENCES users(id)
trigger_key     text NOT NULL
is_enabled      boolean DEFAULT true  -- user-level override
-- When false, this user does not receive this notification regardless of role default
```

### `knowledge_documents`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
title           text NOT NULL
type_tag        text  -- 'standard_works' | 'general_conference' | 'other'
file_url        text  -- Supabase Storage
status          text DEFAULT 'active'  -- 'active' | 'inactive'
speaker         text  -- ai-d; conference talks only
speaker_role    text  -- ai-d; 'prophet'|'apostle'|'seventy'|'presiding_bishopric'|'auxiliary'|'other'
conference_date date  -- ai-d; FIRST DAY OF THE CONFERENCE MONTH (2026-04-01), never a timestamp
uploaded_by     uuid REFERENCES users(id)
uploaded_at     timestamptz DEFAULT now()
```

**The three `ai-d` columns are nullable, and nullable is load-bearing.** Every document ingested
before `ai-d` — the entire standard works included — has none of them and must keep retrieving
exactly as it did. `speaker_role` is **the calling held when the talk was given**, not the
speaker's current calling: a 2015 talk by a member of the Twelve who now presides is `apostle` and
stays `apostle`. That is the only reading the column can answer on its own.

A `general_conference` document with all three null is reachable by **no** filter, which per the
search function below means it is silently **always included**. `/knowledge` badges such a
document "Not filterable" rather than leaving that to be discovered months later.

### `document_chunks`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
document_id     uuid REFERENCES knowledge_documents(id)
ward_id         uuid REFERENCES wards(id)
content         text NOT NULL
embedding       vector(1536)  -- pgvector; dimension matches embedding model
chunk_index     integer
created_at      timestamptz DEFAULT now()
```

### `retrieval_filters`  *(ai-d)*
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
label           text NOT NULL
source_phrase   text NOT NULL  -- what the user typed; the only durable explanation of the columns
speaker_roles   text[]  -- NULL = this axis is not filtered. NEVER an empty array.
speakers        text[]  -- NULL = this axis is not filtered. NEVER an empty array.
since           date    -- absolute, unlike the panel's relative recency select
created_by      uuid REFERENCES users(id)
created_at      timestamptz DEFAULT now()
UNIQUE (ward_id, label)
-- CHECK: at least one of speaker_roles / speakers / since is non-null
-- CHECK: cardinality(...) > 0 on each array (migration 035 — array_length returns NULL on '{}')
```

**NULL means "this axis is not filtered"; an empty array means the opposite.** `= any ('{}')`
matches nothing, so an empty array would save a filter that silently returns zero documents while
reading everywhere as "no restriction". Three layers refuse it: the Zod schema, the merge
function, and the CHECK constraints. Migration 034's first attempt used `array_length`, which
returns NULL rather than 0 on an empty array and therefore passed — 035 fixed it with
`cardinality`.

There is **no UPDATE path** — a filter is created and deleted, never edited. Editing one silently
changes what every past retrieval meant, and `source_phrase` would then describe a filter that no
longer does what it says.

### `retrieval_suggestions`  *(ai-d)*
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
run_id          uuid NOT NULL  -- one per retrieveChunks call, shared by every document it returned
module          text NOT NULL
document_id     uuid REFERENCES knowledge_documents(id) ON DELETE CASCADE
created_at      timestamptz DEFAULT now()
```

Written on every retrieval, read by nothing yet. **ITER-012's display is separate work**; the
telemetry ships now because it cannot be backfilled — every week without the write is a week
permanently missing from the denominator of "appeared in 8 of your last 20 generations". `run_id`
is what makes that denominator countable at all.

**This table stores document ids and timestamps. It never stores the query, the prompt, or the
generated text.** Append-only: no update or delete policy.

### `ai_settings`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
tone_voice              text
doctrinal_emphasis      text
scripture_preferences   jsonb
conference_preferences  jsonb
topic_preferences       text
ward_context            text
thank_you_preferences   text
saved_by        uuid REFERENCES users(id)
created_at      timestamptz DEFAULT now()
-- Keep all versions; latest created_at is active
```

**`conference_preferences` shape** (the `scope` key added by `ai-d`):

```jsonc
{
  "maxYearsOld": 5,            // PROSE to the model: prefer recent talks among what it was given
  "maxTalks": 3,
  "preferKnowledgeBase": true,
  "scope": {                   // SQL FILTER: which talks are searchable at all. null = unset.
    "sinceYears": 2,           // RELATIVE, resolved to a date at retrieval time. null = no limit.
    "speakerRoles": [],        // [] means NO RESTRICTION, not "no roles"
    "savedFilterIds": []       // ids from retrieval_filters; a missing id is ignored, not fatal
  }
}
```

**`maxYearsOld` and `scope.sinceYears` are different things and the UI says so in words.**
`maxYearsOld` shapes **output** — prose asking the model to prefer recent talks among whatever it
received. `scope.sinceYears` shapes **input** — a SQL filter deciding what retrieval can find at
all. They live on two different screens (`/ai-settings` and `/knowledge`), and shipping them
without naming the difference is how a bishopric ends up with two recency controls it cannot tell
apart.

`scope` is **nullable with a default of null** in the Zod schema, which is load-bearing: every
`ai_settings` row written before `ai-d` has no `scope` key, and `lib/ai/queries.ts` parses stored
rows through that schema. A required field would fail the parse and silently discard every ward's
existing conference preferences.

`scope.sinceYears` is stored **relative** and resolved against today at retrieval time. Pinning
the date at save time would make "the last two years" drift a month further from the truth every
month, with nothing on screen changing. A saved filter's `since`, by contrast, is absolute — it is
a pinned statement.

### `audit_log`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
user_id         uuid REFERENCES users(id)
action          text NOT NULL  -- e.g. 'login' | 'assignment_approved' | 'setting_changed'
module          text           -- e.g. 'assignments' | 'admin' | 'visit_tracker'
detail          jsonb          -- structured context for the action
created_at      timestamptz DEFAULT now()
```

### `conversation_threads` *(framework only — no UI in v1)*
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
org_id          uuid REFERENCES organizations(id)  -- null for ward council thread
thread_type     text  -- 'org' | 'ward_council'
created_at      timestamptz DEFAULT now()
```

### `conversation_messages` *(framework only — no UI in v1)*
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid NOT NULL REFERENCES wards(id)
thread_id       uuid REFERENCES conversation_threads(id)
user_id         uuid REFERENCES users(id)
body            text
created_at      timestamptz DEFAULT now()
```

### `sacrament_rotation_pools`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
assignment_type text NOT NULL  -- 'bread_blessing' | 'water_blessing' | 'setup_takedown' | 'bread_provider'
member_ids      uuid[]  -- ordered array of member ids defining the rotation
created_by      uuid REFERENCES users(id)
updated_at      timestamptz DEFAULT now()
created_at      timestamptz DEFAULT now()
```

### `sacrament_assignment_managers`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
member_id       uuid REFERENCES members(id)
user_id         uuid REFERENCES users(id)  -- linked youth user account
assigned_by     uuid REFERENCES users(id)
assigned_at     timestamptz DEFAULT now()
is_active       boolean DEFAULT true
-- Only one active manager per ward at a time
```

### `sacrament_assignments`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
sunday_id       uuid REFERENCES sundays(id)
assignment_type text NOT NULL  -- 'bread_blessing' | 'water_blessing' | 'setup_takedown' | 'bread_provider'
member_ids      uuid[]  -- one or two members (setup_takedown is a pair)
is_override     boolean DEFAULT false  -- true if manually set outside rotation
override_reason text
created_by      uuid REFERENCES users(id)
updated_by      uuid REFERENCES users(id)
created_at      timestamptz DEFAULT now()
updated_at      timestamptz DEFAULT now()
```

### `sacrament_send_log`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
month           date  -- first day of the month these assignments cover
sent_by_user_id uuid REFERENCES users(id)
sent_at         timestamptz DEFAULT now()
-- Logged when assignment manager taps "Message sent"
```

### `public_pages`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
page_type       text NOT NULL  -- 'sacrament_assignments' | 'program'
slug            text UNIQUE NOT NULL  -- e.g. 'buffalo-ward-assignments'
is_active       boolean DEFAULT true
created_at      timestamptz DEFAULT now()
-- Persistent public URL: /public/[slug]
-- No auth required to view
```

---

## Row Level Security (RLS) Policies

Enable RLS on all tables. Key patterns:

**Ward scoping** — every table policy checks `ward_id = (SELECT ward_id FROM users WHERE id = auth.uid())`

**Role-based access** — check `role` from the `users` table for the authenticated user

**Private notes** — `visit_private_notes` and `activity_private_notes`: `user_id = auth.uid()` for all operations

**Tithing** — `tithing_sessions` and `tithing_entries`: role must be `bishop` or `counselor`

**Org scoping** — visit_logs, activity_events, etc.: non-bishopric users can only read/write records where `org_id = (SELECT org_id FROM users WHERE id = auth.uid())`

**Cross-org visibility** — visit_logs shared_notes readable by all org users when `ward.settings->>'cross_org_visibility' = 'true'`

**Sacrament assignments** — `sacrament_assignments` and `sacrament_rotation_pools`: bishopric can read/write; active assignment manager user can read and update assignments only; no other roles

**Public pages** — `/public/[slug]` reads two views and no base table. Note the two public pages do
NOT agree about names: the program page publishes them in full, while `public_sacrament_assignments`
still exposes `first_name` plus `left(last_name, 1)`. Phase 10 owns that page and that decision. `anon` holds a grant on `public_program` and `public_sacrament_assignments` and on nothing else — not even `public_pages`. Both views are `security_invoker = false`, so they run with the owner's rights and are **not** re-filtered by the caller's RLS: the projection *is* the boundary. See §Public Pages.

---

## Public Pages

The application's only unauthenticated surface, and the one place where a mistake is published
rather than merely wrong. Three layers, and each is independently sufficient to stop a leak:

| Layer | File | What it guarantees |
|---|---|---|
| The projection | `lib/program/publicProjection.ts` | `toPublicProgram()` builds a new object field by field. Forbidden fields are **absent from the `PublicProgram` type**, not nulled, so rendering one is a compile error |
| The column | `programs.public_data` (migration 039) | Stores that function's output and nothing else. Written only by `POST /api/programs/[id]/approve`, never from a request body; cleared to `null` whenever the program returns to `draft` |
| The view | `public_program` (migration 039) | Names its columns explicitly — never `SELECT *` — and exposes `public_data`, never `draft_data` |

### What the program page exposes, field by field

| Field | Public | Why |
|---|---|---|
| Ward name, meeting date, meeting order | ✅ | The point of the page |
| Hymn number and title | ✅ | Printed on every paper program |
| **Every person's name** | ✅ **In full, first and last** | A sacrament programme names the people taking part, and names all of them the same way |
| Announcements, ward business, special notes | ✅ | Written by the secretary to be read aloud to everyone |
| Phone numbers | ❌ | |
| Street addresses and emails | ❌ | |
| Leadership contacts | ❌ | Names *and phone numbers* of specific people |
| Missionary information | ❌ | Same, and often includes a personal phone |
| Member ids, user ids, any identifier | ❌ | |
| Anything not in this table | ❌ | Default deny |

**Names in full is a reversal, made 2026-08-24.** The page originally shortened a ward member to
"Sarah W." while naming an external speaker in full (ITER-004). Walking scenario 032 settled that
the split read as a bug sitting beside the visitor's full name rather than as a rule. The
shortening lived in `publicNameFor()` and is gone; nothing else in the table moved.

Because a full-name roster on an indexable page is a different exposure from one on a handout, the
public shell sends `robots: { index: false, follow: false }` (`app/public/layout.tsx`). Anyone with
the link or the QR code reads the page exactly as before; search engines are asked not to keep it.
That is not an access control — the view and the projection are.

`printedName` does not appear anywhere in `publicProjection.ts` and must never appear there. The
two halves now default to the same text, which makes reading either one look harmless — that is
exactly why the rule is kept by habit. `publicName` is the field a ward edits when it wants the web
to say something the handout does not, and reading `printedName` would silently discard that edit.
`speakers[].kind` is not carried through either: publishing the discriminator would announce which
names came from the roster and which were typed.

### The gate

A program is public when it is **`distributed`**, not when it is `approved`. FEATURES.md says the
page "always reflects the most current approved version", which reads the other way; the tension is
resolved deliberately, because distribution *is* the act of publishing. An approved program is a
document the bishopric has signed off and not yet handed to anybody.

**A slug identifies a ward's program page, not a program.** `public_program` joins `public_pages`
to `programs` on `ward_id` alone, so an active slug matches every distributed program that ward has
ever had. The page serves the one with the **latest `sunday_date`** — next Sunday's program becomes
the answer the moment it is distributed, and stays the answer through the meeting it was printed
for. `program-d` creates at most one program page row per ward for this reason; a second slug would
be a second URL onto the same program.

### Not existing

An unknown slug, a deactivated slug, an undistributed program and an unparseable projection all
produce the **same 404**. Distinguishing them would let somebody with a word list work out which
slugs exist. A database *error* is not one of them: `lib/program/publicQueries.ts` throws, so a
dropped grant surfaces as a 500 in a log rather than as a 404 that looks like an ordinary typo.

`revalidate = 300`, and `program-d`'s distribute route calls `revalidatePath()` so a change appears
immediately. There is no `generateStaticParams` — pre-rendering every ward's slug would bake ward
data into the deployment.

---

## API Routes (Next.js App Router)

### Auth
```
POST   /api/auth/invite          Generate invite link
POST   /api/auth/register        Complete registration from invite token
POST   /api/auth/login
POST   /api/auth/logout
```

### Roster
```
GET    /api/members              List members (filtered by org if non-bishopric)
POST   /api/members              Create member
PATCH  /api/members/[id]         Update member
GET    /api/members/[id]/speaker-history   Bishopric-only. A SEPARATE call, deliberately
GET    /api/households           List households
POST   /api/households           Create household
POST   /api/roster/import        CSV import
```
`GET /api/members/[id]/speaker-history` is a route this spec did not list, added in talks-d. It is
separate from every other member read ON PURPOSE: reliability flags and speaking history must never
be a field on the shared member type, because a field on a shared type is one refactor away from a
response a non-bishopric caller receives. It asserts `talks.view` **and** that the caller is
bishopric, on top of `assignment_history` already being bishopric-only in migration 019 — the
policy is the boundary, and the two checks make the refusal an honest 403 rather than an empty
history that reads as "this member has never spoken".

### Sunday Calendar
```
GET    /api/sundays              List Sundays
POST   /api/sundays              Create Sunday record
PATCH  /api/sundays/[id]         Update Sunday
```

### Assignments
```
GET    /api/assignments          List assignments (by sunday_id or month)
POST   /api/assignments          Create assignment
PATCH  /api/assignments/[id]     Update assignment (stage, outcome, message, etc.)
POST   /api/assignments/[id]/approve     Submit approval
POST   /api/assignments/[id]/ai-message  Draft a confirmation/thank-you. Writes NOTHING
GET    /api/assignment-comments  List comments (by assignmentId or sundayId)
POST   /api/assignment-comments  Post a comment at either level
```
`assignment_comments` is ONE table serving both an assignment-level thread and a month-level one,
so one route serves both rather than splitting month comments awkwardly under
`/api/sundays/[id]`. `PATCH /api/assignments/[id]` takes a discriminated union —
`{ action: 'update' }`, `{ action: 'transition' }` or `{ action: 'waive_contact' }` — never a
field update and a stage move in one request.

### Prayers
```
GET    /api/prayers              List prayer assignments by Sunday or by date range
POST   /api/prayers              Assign a prayer BY SLOT — a second write replaces the member
PATCH  /api/prayers/[id]         Change who is praying, or move one stage
```

Prayers run their own four-stage pipeline — `assign → ask → confirm → done` — with no approval
gate. They ride on `talks.view` and `talks.plan`; there is deliberately **no `prayers.*`
permission**, because a prayer is part of planning the meeting.

**Prayers survive `speaking_slots = 0`.** A fast Sunday still has an invocation and a benediction,
so nothing on this path is gated on the slot count — that guard belongs to speakers only.
Migration 028's unique index on `(ward_id, sunday_id, prayer_type)` is what makes "one invocation
and one benediction per Sunday" true rather than merely intended.

### Topics
```
GET    /api/topics               List topics, filtered by category and status
POST   /api/topics               Create topic (source is set to 'manual' server-side)
PATCH  /api/topics/[id]          Update topic, or archive it. NO DELETE
GET    /api/topic-candidates     The pending AI accept/reject queue
PATCH  /api/topic-candidates     Accept or reject ONE candidate
POST   /api/topics/ai-suggest    Generate candidates. Writes to topic_candidates, NEVER topics
```

`POST /api/topics` sets `source: 'manual'` itself and does not read it from the request: a caller
that could name its own source could launder an AI suggestion into the library as if a person had
typed it. `PATCH /api/topic-candidates` is the only path that writes a topic with
`source: 'ai_generated'`.

### Goals
```
GET    /api/goals                List goals with a COMPUTED status, filtered by target type
POST   /api/goals                Create a goal — the target is verified before insert
PATCH  /api/goals/[id]           Edit a goal, or mark it fulfilled. Never both in one request
```

`GET /api/goals` never returns the `goals.status` column. Status is computed on read by
`lib/goals/goalStatus.ts` and the column is a materialized cache that
`supabase/migrations/029_goal_status_refresh.sql` maintains for a future report to index —
`lib/goals/queries.ts` does not even select it. A stored status goes stale silently, which is the
whole reason for the rule.

`PATCH` takes a discriminated union — `{ action: 'update' }` or `{ action: 'fulfill' }` — following
the same shape as `PATCH /api/assignments/[id]`. An edit and a fulfilment are different events with
different audit rows, and making them mutually exclusive by shape means the schema refuses a
request that tries both. `last_fulfilled_at` is writable by the fulfil path and by nothing else.

`goals.target_id` is polymorphic and carries no foreign key, so both write paths resolve the target
against its table before writing. `target_type: 'group'` is readable but **not creatable** — there
is no `groups` table to verify against, and an unverifiable target is exactly the permanent mystery
that check exists to prevent.

`POST /api/goals` stamps `org_id` from the SESSION and never from the request: a bishopric author
writes a ward-level goal (`org_id` null), anybody else writes one owned by their own organization.
A caller that could name its own owner could put a goal on another organization's board, or make
one invisible to the org that has to act on it. `PATCH` cannot move ownership at all.

### Hymns
```
GET    /api/hymns                Search hymn database
GET    /api/hymns/suggest        AI hymn suggestions for a Sunday's topics
POST   /api/hymns/select         Save hymn selection for a Sunday
```

### Programs
```
GET    /api/programs/by-sunday/[sunday_id]  Get the stored program draft for a Sunday
POST   /api/programs             Build a draft, save an edited one, or move its status
POST   /api/programs/[id]/refresh   Diff against current data; apply only on a second call
POST   /api/programs/[id]/ai-edit   AI conversational edit
POST   /api/programs/[id]/generate-pdf  Generate PDF
POST   /api/programs/[id]/approve
POST   /api/programs/[id]/distribute
```

The read route is nested under `by-sunday/` rather than sitting at `/api/programs/[sunday_id]`.
Next.js refuses to build with two differently-named dynamic segments as siblings — `[sunday_id]`
beside `[id]` is `You cannot use different slug names for the same dynamic path`. A static segment
also says out loud which kind of id the handler takes, which reusing `[id]` for both meanings
would not.

`POST /api/programs` carries a discriminated `action`, following `updateAssignmentSchema`:

| `action` | Body | Does |
|---|---|---|
| `build` | `sundayId`, optional `draft` | Assembles from current data, or stores the draft as given |
| `save` | `programId`, `draft` | Stores an edited draft; never moves the status |
| `status` | `programId`, `to: draft \| pending_approval` | Submits for approval, withdraws, or reopens an approved program |

Saving and moving the status are mutually exclusive **by shape**, so a save cannot submit a
program for approval as a side effect.

### Agendas
```
GET    /api/agendas              List agendas
POST   /api/agendas              Create agenda
PATCH  /api/agendas/[id]         Update agenda
POST   /api/agendas/[id]/publish Generate PDF and trigger email distribution
```

### Visit Tracker
```
GET    /api/visits               List visit logs (scoped by org)
POST   /api/visits               Create visit log
PATCH  /api/visits/[id]          Update shared notes, flag
POST   /api/visits/[id]/private-note  Add/update private note
GET    /api/visits/progress      Dashboard summary by org
```

### Youth Activities
```
GET    /api/youth/profiles       List activity profiles
POST   /api/youth/profiles       Create profile
PATCH  /api/youth/profiles/[id]  Update profile
POST   /api/youth/calendars      Import calendar (ICS or Google URL)
GET    /api/youth/events         List events
PATCH  /api/youth/events/[id]    Update event (type, status)
POST   /api/youth/events/[id]/attend    Add self as attendee
POST   /api/youth/events/[id]/assign    Assign attendee (bishopric only)
POST   /api/youth/logs           Log post-activity report
```

### Tithing

**These routes do not exist yet and are Phase 9 work — see §Tithing Auto-Clear.** They were
cancelled on 2026-08-24, when the calculator shipped as a browser-only worksheet, and
reinstated on 2026-08-25 when that decision was reversed. `GET /api/tithing/session` returns
the **ward's** active worksheet — one per ward, shared by the bishopric, not one per user and
not one per date.
```
GET    /api/tithing/session      Get or create the ward's active worksheet
POST   /api/tithing/entries      Create entry
PATCH  /api/tithing/entries/[id] Update entry
DELETE /api/tithing/entries/[id] Delete entry
DELETE /api/tithing/session      Clear all entries — shared, discards others' too
```

### Knowledge Base
```
POST   /api/knowledge/upload     Upload and chunk document          [BUILT — ai-b]
GET    /api/knowledge/documents  List documents                     [BUILT — ai-b]
PATCH  /api/knowledge/documents/[id]  Update status                 [BUILT — ai-b]
DELETE /api/knowledge/documents/[id]  Delete document + chunks      [BUILT — ai-b]
POST   /api/knowledge/search     Bishopric-facing retrieval test    [BUILT — ai-b]
GET    /api/knowledge/filters    List the ward's saved filters      [BUILT — ai-d]
POST   /api/knowledge/filters    Save an accepted proposal          [BUILT — ai-d]
DELETE /api/knowledge/filters/[id]  Delete a saved filter           [BUILT — ai-d]
POST   /api/knowledge/filters/resolve  Phrase to proposed filter    [BUILT — ai-d]
```

**`/api/knowledge/filters/resolve` writes nothing.** It returns a proposal and the sentence
`describeFilter()` renders for it; only a POST to `/api/knowledge/filters` turns that into a row.
Propose, show, accept — CLAUDE.md rule 3 applied to a filter instead of a topic, the same shape
`topic_candidates` uses. It is the one Claude call in `ai-d`, at `effort: "low"`, and it does
**not** use `buildSystemPrompt`: it is a parser matching a phrase against a fixed vocabulary, not
a judgment about the ward.

`POST /api/knowledge/search` gained a `useScope` flag defaulting to **true**. Scoped is the honest
preview — it shows what topic suggestions actually retrieve; unticking it searches everything,
which is what you want while deciding what the scope should be.

**`/api/knowledge/search` is NOT internal-use, and this line has been corrected.** It previously
read "semantic search (internal use by AI routes)"; nothing uses it that way and nothing should.
Server code reaches server code with a function call — `ai-c`'s routes import `retrieveChunks()`
from `lib/ai/retrieve.ts` directly. An internal HTTP hop to your own app costs a round trip, a
second auth pass and a cold start, and can fail in ways a function call cannot.

The route exists for a better reason: it is the only way to **see what the corpus actually
returns**. When a topic suggestion cites something odd, the question is whether retrieval or the
prompt is at fault, and one query at `/knowledge` answers it. It returns the raw similarity score
because that surface exists to be inspected.

### AI Settings

All five BUILT (`ai-a-client-and-settings`). `ai_settings` is append-only: nothing here updates
or deletes a row, and restore appends a copy rather than removing the versions after it.

```
GET    /api/ai-settings          Get active settings          BUILT  ai_settings.view
POST   /api/ai-settings          Append a new settings version BUILT  ai_settings.manage
GET    /api/ai-settings/history  List all versions            BUILT  ai_settings.view
POST   /api/ai-settings/restore/[id]  Copy a version forward  BUILT  ai_settings.manage
POST   /api/ai-settings/preview  Run a test prompt against DRAFT settings in the body
                                                              BUILT  ai_settings.manage
```

`preview` takes `ai_settings.manage`, not `.view`: it spends money and sends ward text to a
third-party vendor, which is the authority to change the settings rather than to read them. It
reads and writes NOTHING in `ai_settings`.

### Notifications
```
GET    /api/notifications        Get current user's notifications
PATCH  /api/notifications/[id]/read
GET    /api/notification-settings    Admin: list all triggers and config
PATCH  /api/notification-settings/[trigger]  Admin: toggle or update recipients
PATCH  /api/notification-prefs/[trigger]     User: toggle personal opt-out
```

### Sacrament Administration
```
GET    /api/sacrament/pools             Get rotation pools (all types)
PATCH  /api/sacrament/pools/[type]      Update rotation pool members and order
GET    /api/sacrament/assignments       Get assignments (by month)
PATCH  /api/sacrament/assignments/[id]  Update assignment (swap, override)
POST   /api/sacrament/generate          Auto-generate month assignments from pools
GET    /api/sacrament/manager           Get current active assignment manager
PATCH  /api/sacrament/manager           Set active assignment manager (bishopric)
POST   /api/sacrament/send-log          Log that assignments message was sent
GET    /api/sacrament/send-log          Get send history
```

### Public Pages (no auth required)
```
GET    /public/[slug]                   Render public page (assignments or program)
```

There is **no** `/api/public/[slug]`. It was specified and deliberately not built: a JSON endpoint
beside the page is a second unauthenticated surface with a second column list to keep correct, and
nothing needs it — `/public/[slug]` is a Server Component that reads the view directly and ships no
client JavaScript to fetch anything with. Adding one later means duplicating the projection, and
the whole design of §Public Pages is that the projection exists exactly once.

`page_type` is not read by the page. `public_pages` is not granted to `anon`, and it does not need
to be: each view filters on its own `page_type`, so **which view answers is the page type**.

### Admin
```
GET    /api/admin/users          List all users
PATCH  /api/admin/users/[id]     Update role, org, active status
POST   /api/admin/users/youth    Create youth account (username + PIN, no email)
PATCH  /api/admin/users/[id]/reset-pin  Reset youth PIN
GET    /api/admin/audit-log      Query audit log
GET    /api/admin/role-access    Get role access matrix
PATCH  /api/admin/role-access    Update role access (with bishopric notification)
GET    /api/admin/ward-settings  Get ward settings
PATCH  /api/admin/ward-settings  Update ward settings (with bishopric notification)
```

---

## Component Structure

```
/app
  /layout.tsx                  Root layout with theme provider, auth guard
  /dashboard/page.tsx          Role-based dashboard router
  /calendar/page.tsx           Sunday calendar
  /assignments/                BUILT in talks-b. The primary talk-pipeline surface
    /page.tsx                  Monthly assignment planner (Server Component)
    /MonthPlannerBoard.tsx     "use client" — modal state + the month's TanStack Query cache
    /AssignmentModal.tsx       Plan or edit one assignment; where most of the work happens
    /SpeakerField.tsx          The ward-member / outside-speaker switch (ITER-004)
    /ApprovalPanel.tsx         n-of-n approvals, approve, request changes
    /AssignmentEditButton.tsx  "use client" — opens the modal from the Server-rendered detail page
    /ContactStagePanel.tsx     REQUEST → CONFIRM → NOTIFY → APPRECIATE, or the waiver
    /CommentThread.tsx         "use client" — realtime, both comment levels
    /[sunday_id]/page.tsx      Single Sunday assignment detail
  /talks/
    /pipeline/page.tsx         NOT BUILT. A kanban by stage was dropped in talks-b: the pipeline
                               is nine stages, not nine screens, and /assignments is the surface
                               a bishopric actually works in. The sidebar's Talks link points at
                               /assignments
    /topics/page.tsx           BUILT in talks-c. Topic library (Server Component)
    /topics/TopicList.tsx      "use client" — filters, add, edit, archive
    /topics/TopicForm.tsx      The manual add path; Phase 5 reuses it for an accepted candidate
    /topics/CandidateQueue.tsx "use client" — accept/reject, one candidate at a time
    /history/page.tsx          Speaker history
  /prayers/
    /page.tsx                  BUILT in talks-c. Prayer tracker (Server Component)
    /PrayerBoard.tsx           "use client" — invocation and benediction per Sunday, four stages
  /program/                    As BUILT in program-b. The list is new — the original tree had
    /page.tsx                  only the detail page, and a builder with no way in needs one
    /[sunday_id]/page.tsx      Server Component — guards, loads, hands the draft down
    /[sunday_id]/ProgramBuilder.tsx    "use client" — the form state and its TanStack Query cache
    /[sunday_id]/MeetingOrderForm.tsx  "use client" — every draft field, edited
    /[sunday_id]/MissingPanel.tsx      What is still needed, as sentences. Never an error state
    /[sunday_id]/RefreshButton.tsx     "use client" — /refresh with apply:false, then confirm
    /[sunday_id]/AiEditPanel.tsx       "use client" — the conversation, its diff and its errors
    /[sunday_id]/BuildProgramButton.tsx  "use client" — the one action a Sunday with no row offers
  /music/page.tsx              Music coordinator view
  /visits/
    /page.tsx                  Visit tracker dashboard
    /[household_id]/page.tsx   Household visit history
    /feed/page.tsx             Return & report feed
  /youth/
    /page.tsx                  Youth activity dashboard
    /profiles/page.tsx         Activity profiles
    /calendar/page.tsx         Activity calendar
    /events/[id]/page.tsx      Event detail
  /tithing/page.tsx            Tithing calculator — lives under app/(tithing)/, NOT app/(app)/.
                               Its header and tab bar are sticky at the top of the viewport, which
                               cannot be true beneath the app sidebar and TopNav. Its components
                               sit beside the page rather than under /components/tithing/, because
                               nothing outside this one screen renders them.
  /agendas/
    /page.tsx                  Agenda list
    /[id]/page.tsx             Agenda builder
  /knowledge/page.tsx          Knowledge base management
  /ai-settings/page.tsx        AI behavior configuration
  /sacrament/
    /page.tsx                  Sacrament assignments (manager view)
    /admin/page.tsx            Rotation pool configuration (bishopric)
  /public/
    layout.tsx                 No-auth shell: no sidebar, nav, theme toggle or QueryProvider
    /[slug]/page.tsx           Branches on which view answers; 404s for every other outcome
    /[slug]/ProgramPanel.tsx   The program branch — renders PublicProgram and nothing else
    /[slug]/not-found.tsx      One vague 404 for unknown, inactive and undistributed alike
  /admin/
    /page.tsx                  Admin home
    /users/page.tsx            User management
    /roles/page.tsx            Role access matrix
    /notifications/page.tsx    Notification management
    /ward-settings/page.tsx    Ward configuration
    /audit-log/page.tsx        Audit log viewer

/components
  /ui/                         Shared primitives (Button, Card, Modal, etc.)
  /layout/
    Sidebar.tsx
    TopNav.tsx
    NotificationBell.tsx
    ThemeToggle.tsx
  /roster/
    HouseholdList.tsx
    MemberPicker.tsx
    MemberStatusBadge.tsx
    ReliabilityFlag.tsx
  /assignments/                As BUILT in talks-b. The module-scoped screens live under
    StageBadge.tsx             /app/(app)/assignments; these are the shared pieces
    SpeakerLine.tsx            One speaker, member or external — Phase 6 reuses this rather than
                               re-deriving a display name, or an external speaker's title goes
                               missing on the printed program
    SpeakerList.tsx            The `speakers` reserved region on SundayCell and SundayCard
    PipelineStatusSummary.tsx  The `pipelineStatus` reserved region
    SmsHandoff.tsx             The sms: link AND the copy fallback, always both
                               (PipelineCard, ApprovalThread and AIMessageComposer were the
                               guess; the first two are folded into the pages above and
                               AIMessageComposer belongs to Phase 5)
  /program/                    As BUILT in program-b. ProgramEditorChat was the guess; the
    ProgramPreview.tsx         conversation lives in AiEditPanel beside the form it edits, and
    DraftDiff.tsx              the diff it renders is SHARED with the refresh flow — one panel,
    ProgramStatusBadge.tsx     two callers, so neither can word the same table differently
  /visits/
    VisitDashboard.tsx
    VisitProgressMap.tsx
    VisitLogForm.tsx
    ReportFeed.tsx
    ReportTile.tsx
  /youth/
    ActivityProfile.tsx
    ActivityCalendar.tsx
    EventCoverageCard.tsx
    AwarenessDigest.tsx
  /agendas/
    AgendaBuilder.tsx
    ActionItemList.tsx
  /ai/
    HymnSuggestions.tsx
    TopicSuggestions.tsx
    ScriptureSuggestions.tsx
  /notifications/
    NotificationCenter.tsx
    NotificationFeed.tsx
  /sacrament/
    AssignmentMonth.tsx        Monthly grid of all four assignment types
    RotationPoolEditor.tsx     Bishopric tool to configure pools and order
    AssignmentOverrideModal.tsx  Insert special assignment for one Sunday
    SendConfirmButton.tsx      Manager taps to mark message sent
  (no /components/public — the public pages' components are colocated under app/public/[slug]/,
   deliberately. A shared component folder invites reuse from an authenticated screen, and the
   moment a public component takes a wider prop the privacy boundary moves into JSX.)
```

---

## AI Integration

### System Prompt Construction
Every Claude API call prepends a system prompt assembled from:
1. Active `ai_settings` record for the ward, rendered as PROSE (null and blank fields skipped)
2. Module-specific instructions plus the citation instruction
3. Retrieved knowledge base chunks (via pgvector semantic search) — the block is OMITTED entirely
   when there are none

`buildSystemPrompt()` in `lib/ai/systemPrompt.ts` is **pure and takes resolved settings as an
argument** rather than a `wardId`. A function that resolves its own ward needs a database to
test; the caller resolves settings, this assembles them. It returns
`Anthropic.TextBlockParam[]` — two blocks when there are no chunks, three when there are.

**The cache breakpoint sits on block 1, the last stable block, and the chunks come after it.**
Caching is a prefix match, so anything cached after per-request chunks never hits. Block 0 is
present even when settings are null, so the prefix shape is constant.

### Knowledge Base Retrieval
```
1. Embed the query (topic, prompt) using the same embedding model used at upload
2. Run pgvector similarity search on document_chunks WHERE ward_id = [ward_id] AND document.status = 'active'
3. Return top 5–8 chunks by cosine similarity
4. Inject chunks into the Claude prompt as reference material
5. Instruct Claude to cite sources in its response
```

### Embedding Model
Use OpenAI `text-embedding-3-small` (1536 dimensions) for document chunking and query embedding. Requires OpenAI API key in addition to Claude API key.

### Chunking Strategy
- Chunk size: ~500 tokens with 50-token overlap
- Split on paragraph boundaries where possible
- Each chunk stores: content, document_id, chunk_index, embedding

**Token estimation is 4 characters per token** (`CHARS_PER_TOKEN_ESTIMATE` in
`lib/knowledge/chunk.ts`). There is no tokenizer in this project and adding one is not worth a
dependency: chunk size affects retrieval granularity, not correctness, so overshoot is harmless.

**Two entry points, and the second is not optional.** `chunkText()` handles uploaded prose:
paragraphs, falling back to sentence boundaries for an over-long paragraph and to a hard character
split only for a sentence that exceeds the target on its own. `chunkByBoundaries()` takes
pre-split labelled sections and gives each its own chunk — **two sections are never merged**. That
is the scripture path: a chunk spanning the end of Alma 32 and the start of Alma 33 retrieves
badly and cites worse. `supabase/scripts/ingestStandardWorks.ts` groups verses into chapters and
feeds them through it.

**Labels are stored as a `[bracketed prefix]` on `content`**, not in a column — migration 014 has
no `label` on `document_chunks`, and the prefix is embedded along with the text so "Alma 32" is
itself signal. `lib/ai/retrieve.ts` reads it back out to build the citation.

**A chunk whose embedding failed is still inserted, with `embedding = null`.** Dropping it would
lose the text and hide the failure; `match_document_chunks` excludes nulls, and `/knowledge` shows
chunk count and embedded count as two separate numbers so the gap is visible.

### Vector Index — HNSW, not ivfflat
Migration 031 builds `document_chunks_embedding_idx` using **HNSW**, deviating from
`05-ai-platform.md`. ivfflat trains its list centroids on the data present at build time, so it
must be created *after* ingestion and rebuilt when the corpus changes shape — an instruction
somebody eventually forgets, leaving a worthless index nobody notices. HNSW has no training step:
correct on an empty table, correct as rows arrive, better recall at the same query cost. The cost
is a slower build, which at this scale is seconds. Migration 031 refuses to apply if the database
has no `hnsw` access method (pgvector < 0.5.0).

### The Search Function
`match_document_chunks(query_embedding, match_ward_id, match_count, filter_since,
filter_speaker_roles, filter_speakers)` is **SECURITY INVOKER**, and
that is load-bearing rather than incidental. RLS applies inside the function, so
`document_chunks_ward_select` is the real ward boundary and `match_ward_id` is defence in depth.
`tests/rls/retrieval-scoping.test.ts` calls it with another ward's uuid and asserts it still
returns nothing — that assertion is the reason the default must never be changed to
SECURITY DEFINER.

**The three filter parameters apply to `general_conference` documents and to nothing else** —
this is the single most dangerous thing in the schema to get wrong, and its failure is silent. A
naive `d.conference_date >= filter_since` removes every document whose `conference_date` is null,
which is the entire standard works: a ward sets "last two years" to narrow its conference talks
and quietly loses the Book of Mormon from every suggestion, with nothing erroring and no test
failing. The predicate is therefore `d.type_tag is distinct from 'general_conference'` **or**
every non-null filter matches. `is distinct from` rather than `<>`, because `null <> 'x'`
evaluates to NULL and would drop every untagged document the moment any filter was set.

`tests/db/retrieval-filters.test.ts` asserts the exemption from four directions and carries a
regression gate proving the unfiltered call still returns exactly what migration 031's
three-argument version did.

Migration 033 **drops and recreates** the function rather than adding defaulted parameters —
adding them would create an overload and make the old three-argument call ambiguous. Dropping
discards migration 031's `grant execute`, which 033 re-issues; a retrieval failing with a
permission error after `ai-d` is almost certainly that grant and not a policy.

Retrieval applies a **similarity floor of 0.3, filtered before the result is clamped to the
limit** (`lib/ai/retrieve.ts`). A narrow scope does **not** lower that floor: a ward scoped to one
speaker in one year will correctly get nothing back on most queries, and layer 3 is omitted. That
is the floor working, not the scope failing. Filtering after clamping would silently starve the prompt of
context available further down the ranking. An all-weak result set returns nothing at all, because
weak chunks read as authoritative to the model and get cited.

### AI Routes Pattern
All AI API calls are made server-side (Next.js Route Handlers), never from the client. The Claude API key is never exposed to the browser.

### Program AI Editor
- Maintains a conversation history array in component state
- Each user message and Claude response appended to history
- Full history sent with each API call for context continuity
- Current program draft state included in every system message
- Claude returns updated draft JSON; component re-renders preview

---

## Role-Based Dashboards

Each role sees a tailored home screen on login:

**Bishop / Counselor:**
- Talk pipeline status this month (counts by stage)
- Pending approvals requiring action
- Visit progress summary (all orgs, if cross-org enabled)
- Uncovered youth home events this week
- Flagged ward council items
- Away event awareness digest
- Goals nearing due date

**Ward Secretary:**
- Upcoming Sundays needing program attention
- Approved messages ready to send
- Pending program approvals
- Next agenda due date and status
- Notifications

**Executive Secretary:**
- Upcoming meetings and agenda status
- Flagged ward council items queue
- Action items from last meeting

**Music Coordinator:**
- Upcoming Sundays with missing hymn selections
- AI hymn suggestions ready for review
- Confirmed selections for next Sunday

**Org President / Counselor:**
- Their org's visit progress summary
- Households overdue for a visit
- Return & report feed (unread count)
- Flagged items from their org
- Youth activity dashboard (YM/YW only)

**Org Secretary:**
- Their org's scheduling tasks
- Visit log summary

**Ward Council Member:**
- Youth activity calendar (their org's events)
- Uncovered home events needing attention
- Post-activity follow-up prompts

---

## Notification System

### Delivery
All notifications are in-app only (except agenda/program PDF emails via Resend).

### Realtime
Use Supabase Realtime to push notifications to connected clients without polling. Subscribe to the `notifications` table filtered by `recipient_user_id = auth.uid()`.

### Trigger Keys (v1)
```
-- Talk Pipeline
plan_submitted
plan_approved
plan_change_requested
assignment_declined
message_approved_ready
sunday_confirmation_request
issue_flagged_post_sunday
appreciation_comments_ready
assignment_reverted            -- a calendar change voided planning work (migration 025)

-- Admin
admin_setting_changed

-- Calendar
org_conducting_rotation_changed

-- Visits
visit_overdue
visit_flagged_for_ward_council
new_household_added

-- Youth Activities
youth_activity_added
youth_event_uncovered
youth_support_assigned
youth_followup_prompt
youth_followup_submitted

-- Programs
program_pending_approval       -- a builder submitted a program for approval (program-a)
program_approved               -- a bishopric member signed it off (program-a)
program_changes_requested      -- sent back to draft with a comment (program-a)
program_distributed            -- the program went out: emailed where email is configured, and published to /public/[slug] either way

-- Agendas
agenda_published
agenda_email_distributed

-- Sacrament Administration
sacrament_assignments_sent
sacrament_assignments_overdue
sacrament_manager_changed
```

### Adding Triggers (Future)
The `notification_settings` table is the source of truth. Adding a new trigger requires:
1. Insert a row into `notification_settings`
2. Add the trigger emission to the relevant server-side route
3. No schema changes required

---

## Tithing Auto-Clear

**SUPERSEDED (2026-08-24) and REVERSED (2026-08-25). Entries persist; the window is 48 hours.**

The calculator shipped on 2026-08-24 writing NOTHING — no database row, no localStorage, no
server request — with the count living in React state and dying with the tab. That design named
its own cost, that a refresh destroys an in-progress count, and said the decision was to be
revisited if a count was ever lost, with persistence behind the migration 011 tables and never
in browser storage. **It is revisited.** Losing a count is unacceptable and a `beforeunload`
prompt is not a sufficient guard against it.

The rules now:

- **Server-side only**, in `tithing_sessions` and `tithing_entries`, which already carry their
  RLS policies and `tests/rls/tithing-access.test.ts`. **Never browser storage** — that would
  leave dollar amounts on a shared or borrowed phone. Refused twice; the reason has not changed.
- **One shared worksheet per ward.** Not per user, not per date. Any bishopric member opening
  `/tithing` sees the same in-progress count, and entries sync live so one person can enter
  while a second verifies the totals. A partial unique index over unexpired sessions is what
  makes "one" true — nothing in migration 011 prevents a second active session by itself.
- **It clears exactly two ways:** the manual "Clear All Entries" control, or automatically 48
  hours after the **first** entry was saved. Later entries do NOT extend the window: a window
  that can be renewed can be kept alive forever, and a worksheet kept alive forever is the
  permanent record this module exists in order not to be.
- **48 hours is a fixed constant, not a ward setting.** Every knob is a way for the retention
  promise to be weakened by accident.
- **The read path filters on expiry and does not trust the sweep.** An expired worksheet reads
  as empty even if the job below is late or dead. The sweep reclaims rows; the filter is what
  keeps the promise.
- **The `beforeunload` guard on `/tithing` comes off.** It warns that leaving destroys the
  count, which stops being true, and a warning that is not true trains people to dismiss the
  ones that are.

`auto_clear_at` is set when the first entry is saved — that entry's `created_at` plus 48 hours —
and is never updated afterwards. It is `NULL` on a session with no entries, which the second arm
of the sweep collects on age so an abandoned empty worksheet cannot hold the unique index
forever.

**The ward-local-midnight problem is gone rather than deferred.** An elapsed-time window on a
`timestamptz` involves no local date and no timezone, so the UTC-midnight job that would have
wiped an in-progress Sunday-evening count cannot be written by mistake. Do not reintroduce
`session_date` or `CURRENT_DATE` here — `session_date` is display only and a 48-hour worksheet
can span two dates.

The sweep is `pg_cron` or a scheduled Edge Function, run hourly:
```sql
-- Entries cascade from the session via migration 011's FK, so one delete is enough.
DELETE FROM tithing_sessions
WHERE (auto_clear_at IS NOT NULL AND auto_clear_at <= now())
   OR (auto_clear_at IS NULL AND created_at <= now() - interval '48 hours');
```

---

## Sacrament Program PDF

### Generation
- Trigger: `POST /api/programs/[id]/generate-pdf` — requires `program.build` and status
  `approved` or `distributed`. A `draft` is refused with a 409: a printable PDF of a document
  nobody has signed off is exactly the artefact somebody would hand to a librarian.
- Server-side render using `@react-pdf/renderer`, from `lib/pdf/renderProgram.tsx` — the only
  file in the app that calls `renderToBuffer`.
- Bifold layout: 4 panels (cover, inside-left contacts, inside-right meeting order, back
  announcements + QR). **Panel order on the sheet is not reading order** — the imposition table
  lives in `lib/pdf/ProgramDocument.tsx`.
- Fonts are the standard PDF base-14 (`Times-Roman`, `Helvetica`, `Courier`), selected by
  `font_family`. Nothing is registered and no font file is committed, so there is no font fetch
  at render time to fail on a cold start.
- Template variables injected from program `draft_data` JSON.

### Storage
- Bucket `programs`, **private** (`public: false`), created by migration 040 with ward-scoped
  policies following migration 032's shape.
- Objects keyed `[ward_id]/[sunday_date].pdf` — ward first, so `(storage.foldername(name))[1]`
  reads it.
- SELECT is ward-wide (a programme is read aloud on Sunday); INSERT and DELETE are narrowed to
  `bishop`, `counselor`, `ward_secretary`. **There is no UPDATE policy** — a regenerated
  programme is replaced by delete-then-upload, so `upsert: true` is not available.
- `programs.pdf_url` holds a **signed URL with a 90-day lifetime**, not a storage key:
  `/public/[slug]` renders that value straight into an `href`. anon holds no policy on the
  bucket.

### Public page slug
- `public_pages` rows are created on demand by the generate-pdf route
  (`ensureProgramPublicPage`). Nothing created them before program-d, which is why
  `/public/[slug]` had never been reachable.
- Slugs are random (`program-` + 16 hex characters), not derived from the ward's name. The public
  page publishes participants' full names, and `noindex` plus an unguessable URL are the only two
  things in front of that.
- The QR code encodes `NEXT_PUBLIC_SITE_URL` + `/public/[slug]`. With no site URL configured the
  programme prints **without** a QR rather than encoding a guess.

### Template Configuration
Stored in `ward.settings`:
```json
{
  "program_template": {
    "ward_name": "Buffalo Ward",
    "church_name": "The Church of Jesus Christ of Latter-Day Saints",
    "cover_image_url": "...",
    "font_family": "serif",
    "primary_color": "#000000"
  },
  "program_distribution_list": ["secretary@example.com", "bishop@example.com"],
  "librarian_email": "librarian@example.com"
}
```

`primary_color` is checked for contrast against white paper (4.5:1) and falls back to the default
with a reported warning if it fails — a programme printed in pale yellow because a setting was
mistyped is a ward-visible failure with no error attached.

### Distribution
- Trigger: `POST /api/programs/[id]/distribute` — requires `program.distribute` (held by
  `ward_secretary` **and** the bishopric), status `approved`, and a non-null `pdf_url`.
- Recipients: `ward.settings.program_distribution_list` (an array of addresses) plus
  `ward.settings.librarian_email`, deduped case-insensitively. Invalid entries are reported, never
  silently dropped. An empty list is a 422 with its own sentence.
- One send per recipient, not one send with every address in `to` — addresses stay private and
  partial failure becomes observable. Resend's `batch.send` is unusable here: it carries no
  attachments.
- **Email is off until `RESEND_FROM_ADDRESS` names an address at a domain verified in Resend.**
  The route still publishes (status moves, the public page lights up, the QR works) and says
  plainly that nothing was emailed. Resend's shared test sender only delivers to the account
  owner, so a send with it configured would report success and reach nobody.
- Marks the program `distributed`, stamps `distributed_at`/`distributed_by`, emits
  `program_distributed` (migration 041), audits the recipient **count and never the addresses**,
  and revalidates `/public/[slug]`.
- Irreversible. `LEGAL_TRANSITIONS` gives `distributed` no exit.

### Leadership Contacts Auto-Population
- Contacts panel populated from `ward.settings.leadership_contacts`
- When a user record changes (name, role), a prompt is shown: "Leadership contacts in the sacrament program may be affected. Update the program template now?"
- Admin confirms or dismisses — no silent auto-update

---

## Agenda PDF & Email

### Generation
- `POST /api/agendas/[id]/publish` generates PDF and triggers email
- PDF stored in Supabase Storage
- Email sent via Resend to all opted-in users
- Each email includes an unsubscribe link that calls `PATCH /api/notification-prefs/agenda_email`
- Scheduled send: a Supabase Edge Function checks for published agendas and sends at the configured time in `ward.settings.agenda_email_send_time`

---

## Audit Log Implementation

Write to `audit_log` from every significant API route handler:
```typescript
await supabase.from('audit_log').insert({
  ward_id,
  user_id: session.user.id,
  action: 'assignment_approved',
  module: 'assignments',
  detail: { assignment_id, sunday_date }
})
```

Log on: login, logout, any POST/PATCH/DELETE to core tables, admin changes, AI generations, message sends.

---

## Future: Discussion Threads

Tables `conversation_threads` and `conversation_messages` are created at launch but no UI is built. When activated:
- Each org gets a thread; ward council gets its own thread
- Messages are real-time via Supabase Realtime
- Access scoped by org membership (RLS)
- Bishopric can read all threads

---

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
OPENAI_API_KEY              # for embeddings only
RESEND_API_KEY              # for agenda/program email
```

---

## Build Order (Recommended)

1. Supabase schema, RLS policies, seed data (hymn table, default topics)
2. Auth — invite flow, registration, login, role assignment
3. Roster — household and member CRUD, CSV import
4. Sunday calendar
5. Talk assignment pipeline (full PLAN→COMPLETE flow)
6. Prayer assignments
7. Program builder (static first, then AI editor)
8. Music coordinator + hymn suggestions
9. Visit tracker (bishopric first, then expand to orgs)
10. Youth activity support
11. Tithing calculator
12. Agenda builder + PDF email
13. Knowledge base upload + pgvector search
14. AI settings panel
15. Goals & reminders tracker
16. Notification management UI
17. Audit log viewer
18. Sacrament administration (rotation pools, assignments, public page)
19. Public program page + QR code generation
20. Role-based dashboards
21. Light/dark mode polish
22. Multi-ward scaffolding (ward switcher, isolated data verification)
