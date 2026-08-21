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
| AI | Claude API (`claude-sonnet-4-6`) |
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
suggested_scriptures    jsonb  -- array of {reference, text, relevance_note}
suggested_talks         jsonb  -- array of {speaker, title, conference, url}
source          text  -- 'ai_generated' | 'manual' | 'library'
status          text DEFAULT 'active'  -- 'active' | 'archived'
last_assigned_at    timestamptz
created_at      timestamptz DEFAULT now()
```

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
draft_data      jsonb  -- full program content snapshot
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
title           text NOT NULL
target_type     text  -- 'member' | 'household' | 'org' | 'group'
target_id       uuid  -- polymorphic reference
desired_frequency_months    integer
last_fulfilled_at   timestamptz
status          text  -- 'on_track' | 'due_soon' | 'overdue'
notes           text
created_at      timestamptz DEFAULT now()
```

### `tithing_sessions`
```sql
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
ward_id         uuid REFERENCES wards(id)
session_date    date NOT NULL
created_by      uuid REFERENCES users(id)
auto_clear_at   timestamptz  -- always set to midnight of session_date
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
uploaded_by     uuid REFERENCES users(id)
uploaded_at     timestamptz DEFAULT now()
```

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

**Public pages** — `public_pages` records are readable without auth; the pages they power (`/public/[slug]`) query only the specific data needed (assignments or program) scoped to `ward_id`, with no member PII exposed beyond first name and last initial

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
GET    /api/households           List households
POST   /api/households           Create household
POST   /api/roster/import        CSV import
```

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
POST   /api/assignments/[id]/ai-message  Generate AI confirmation/thank-you message
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
GET    /api/prayers              List prayer assignments
POST   /api/prayers              Create prayer assignment
PATCH  /api/prayers/[id]         Update stage
```

### Topics
```
GET    /api/topics               List topics
POST   /api/topics               Create topic
PATCH  /api/topics/[id]          Update topic
POST   /api/topics/ai-suggest    Generate AI topic suggestions
```

### Hymns
```
GET    /api/hymns                Search hymn database
GET    /api/hymns/suggest        AI hymn suggestions for a Sunday's topics
POST   /api/hymns/select         Save hymn selection for a Sunday
```

### Programs
```
GET    /api/programs/[sunday_id] Get program draft for a Sunday
POST   /api/programs             Create/update program draft
POST   /api/programs/[id]/ai-edit   AI conversational edit
POST   /api/programs/[id]/generate-pdf  Generate PDF
POST   /api/programs/[id]/approve
POST   /api/programs/[id]/distribute
```

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
```
GET    /api/tithing/session      Get or create today's session
POST   /api/tithing/entries      Create entry
PATCH  /api/tithing/entries/[id] Update entry
DELETE /api/tithing/entries/[id] Delete entry
DELETE /api/tithing/session      Clear all entries
```

### Knowledge Base
```
POST   /api/knowledge/upload     Upload and chunk document
GET    /api/knowledge/documents  List documents
PATCH  /api/knowledge/documents/[id]  Update status
DELETE /api/knowledge/documents/[id]  Delete document + chunks
POST   /api/knowledge/search     Semantic search (internal use by AI routes)
```

### AI Settings
```
GET    /api/ai-settings          Get current settings
POST   /api/ai-settings          Save new settings version
GET    /api/ai-settings/history  List all versions
POST   /api/ai-settings/restore/[id]  Restore a version
POST   /api/ai-settings/preview  Test current settings with a sample prompt
```

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
GET    /api/public/[slug]               Return JSON data for public page
```

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
  /assignments/
    /page.tsx                  Monthly assignment planner
    /[sunday_id]/page.tsx      Single Sunday assignment detail
  /talks/
    /pipeline/page.tsx         Pipeline view (kanban by stage)
    /topics/page.tsx           Topic library
    /history/page.tsx          Speaker history
  /prayers/page.tsx            Prayer assignment tracker
  /program/
    /[sunday_id]/page.tsx      Program builder
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
  /tithing/page.tsx            Tithing calculator
  /agendas/
    /page.tsx                  Agenda list
    /[id]/page.tsx             Agenda builder
  /knowledge/page.tsx          Knowledge base management
  /ai-settings/page.tsx        AI behavior configuration
  /sacrament/
    /page.tsx                  Sacrament assignments (manager view)
    /admin/page.tsx            Rotation pool configuration (bishopric)
  /public/
    /[slug]/page.tsx           Public assignments or program page (no auth)
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
  /assignments/
    PipelineCard.tsx
    AssignmentModal.tsx
    ApprovalThread.tsx
    AIMessageComposer.tsx
  /program/
    ProgramPreview.tsx
    ProgramEditorChat.tsx      AI conversational editor
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
  /tithing/
    EntryForm.tsx
    SessionSummary.tsx
    EntryList.tsx
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
  /public/
    PublicAssignmentsPage.tsx  Mobile-optimized, no-auth assignments view
    PublicProgramPage.tsx      Mobile-optimized, no-auth program view
```

---

## AI Integration

### System Prompt Construction
Every Claude API call prepends a system prompt assembled from:
1. Active `ai_settings` record for the ward
2. Module-specific instructions (e.g. "You are helping generate a sacrament program")
3. Retrieved knowledge base chunks (via pgvector semantic search)

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

Implement as a Supabase Edge Function (cron) running at midnight:
```sql
DELETE FROM tithing_entries
WHERE session_id IN (
  SELECT id FROM tithing_sessions
  WHERE session_date < CURRENT_DATE
);
DELETE FROM tithing_sessions WHERE session_date < CURRENT_DATE;
```

---

## Sacrament Program PDF

### Generation
- Trigger: `POST /api/programs/[id]/generate-pdf`
- Server-side render using `@react-pdf/renderer`
- Bifold layout: 4 panels (cover, inside-left contacts, inside-right meeting order, back announcements)
- Template variables injected from program `draft_data` JSON
- PDF stored in Supabase Storage under `programs/[ward_id]/[sunday_date].pdf`

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
  }
}
```

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
