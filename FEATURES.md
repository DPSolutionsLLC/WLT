# Ward Leadership Tools (WLT)
### Feature Specification

---

## Overview

Ward Leadership Tools (WLT) is a mobile-first web application for LDS ward leadership to coordinate, track, and manage the full scope of their responsibilities. Built for the bishopric but extended to all ward organizations, WLT replaces scattered spreadsheets, texts, and memory with a single shared platform.

Initially built for one ward, WLT is architected from the start to support adoption by other wards.

**Core design principles:**
- One source of truth for all ward data (roster, calendar, assignments)
- Human oversight on all AI-generated content — nothing sent or saved without approval
- Role-based access — every user sees exactly what's relevant to their calling
- Admin responsibilities shared equally among the full bishopric
- Notifications keep everyone informed; changes are never silent

---

## Application Name & Branding

- **Full name:** Ward Leadership Tools
- **Abbreviation:** WLT
- **Theme:** Light and dark mode supported; user-configurable preference

---

## Tech Stack

- **Frontend:** Next.js (React), mobile-first responsive design
- **Hosting:** Vercel
- **Database & Auth:** Supabase (Postgres + Auth + Realtime + Storage)
- **Vector Search:** Supabase pgvector extension
- **AI:** Claude API (`claude-sonnet-4-6`)
- **PDF Generation:** Server-side (for programs and agendas)
- **Multi-ward ready:** All records scoped to `ward_id` from day one

---

## Organizations Supported at Launch

Each organization has its own presidency structure and optional secretary within WLT:

- Bishopric (also fulfills the Young Men presidency role in this ward)
- Elders Quorum
- Relief Society
- Young Women
- Primary
- Sunday School

Organizations are configurable entities — new orgs can be added without code changes.

---

## User Roles

### Bishopric (Bishop + 1st Counselor + 2nd Counselor)
- Full access to all modules across all organizations
- Shared admin authority — any of the three can make admin changes; the other two are notified of every change
- Final approval on sacrament plans, programs, and outgoing communications
- Access to audit log and user management

### Ward Secretary
- Manage the Sunday calendar
- Build and publish sacrament programs and meeting agendas
- Send approved messages and programs via email or native SMS
- View talk pipeline status and assignment details
- No access to visit trackers, tithing calculator, or org-internal data

### Executive Secretary
- Receive ward council agenda flag notifications from visit reports
- Manage ward council and bishopric meeting agendas
- View upcoming Sunday calendar
- No access to visit tracker details, tithing calculator, or org-internal data

### Org President (EQ, RS, YM, YW, Primary, Sunday School)
- Full access to their organization's visit tracker and goals
- Access to youth activity support (YM and YW presidents only)
- View shared visit reports from other orgs (when cross-org visibility is enabled)
- No access to sacrament planning, tithing calculator, or other orgs' internal data

### Org Counselor
- Same as Org President within their organization

### Org Secretary
- Scheduling and coordination support within their organization
- View their org's visit tracker progress and reports
- No access to other modules

### Music Coordinator
- View upcoming Sunday calendar and assigned speaker topics
- Select hymns for each Sunday (opening, sacrament, closing)
- Log special musical numbers
- Hymn selections feed directly into the program builder

### Ward Council Member (General)
- Access to youth activity support module only
- Enter secular youth activities for youth in their organization
- View the full activity calendar
- Log attendance and post-activity notes for events they attended

### Sacrament Assignment Manager (Youth)
- Logs in via username + PIN (no email required)
- View and adjust the month's sacrament ordinance assignments
- Mark assignments message as sent
- Cannot access any other module

---

## Module 1: Ward Roster

The single source of truth for all ward member data. Every module that references members draws from this roster — there are no separate lists.

### Household & Member Structure
- Members are grouped into households
- Roster can be viewed as a flat list or grouped by household
- All assignment and activity modules browse members through the household view

### Member Record
- First name, last name
- Household link
- Category: `Adult`, `Youth`, `Child`
- Gender
- Status: `Active`, `Moved Out`, `Do Not Contact`
- Phone number
- Home address
- Organization memberships (which orgs they belong to — filters roster views per org)
- Notes (bishopric-visible only)

### Roster Import & Maintenance
- Initial load via CSV import (exported from LCR)
- Ongoing: new members added manually; departing members marked `Moved Out` (records retained for history)
- Address data used by visit tracker map view

---

## Module 2: Sunday Calendar

### Sunday Record
- Date
- Type: `Standard`, `Fast Sunday`, `Stake Conference`, `General Conference`, `Holiday/No Meeting`, `Special`
- Notes (e.g. "High Council Visit", "Stake Youth Fireside")
- Conducting counselor (auto-populated from rotation, editable)
- Number of speaking slots (default: 3, editable)
- Slot lengths (e.g. 5-min youth, 15-min adult)

### Conducting Rotation
- Rotates: Bishop → 1st Counselor → 2nd Counselor by default
- Fully editable by any bishopric member (with notification to the other two)

### Calendar View
- Monthly view showing Sunday type, assignment pipeline status, and speaker names
- Color-coded by pipeline stage

---

## Module 3: Sacrament Talk Management

*Bishopric access only.*

### Assignment Types
Each speaking assignment is tagged to determine rotation eligibility:

| Type | Counts Toward Rotation |
|---|---|
| Sacrament Talk | ✅ Yes |
| Organizational Assignment | ❌ No |
| Returning Missionary | ❌ No |
| New Member / Convert | ❌ No |
| Youth Speaker | Separate youth rotation |
| High Council | ❌ No |

### Talk Assignment Pipeline

```
PLAN → REVIEW → APPROVE → REQUEST → CONFIRM → NOTIFY → SPEAK → APPRECIATE → COMPLETE
```

**PLAN** — Conducting counselor drafts speakers, topics, and prayer assignments for the month. Views reliability flags and rotation history while planning.

**REVIEW** — Plan submitted to other counselor and bishop. Comment threads open for discussion at month and assignment level. All three must approve before advancing.

**APPROVE** — Bishop's approval is the final gate. Status moves to `Planned`.

**REQUEST** — Counselor contacts each speaker personally. Logs date, who contacted, and outcome (Accepted / Declined / Pending).

**CONFIRM** — On acceptance, app generates an AI-assisted confirmation message with topic, suggested scriptures, and suggested General Conference talks. Counselor reviews, edits, and approves before sending.

**NOTIFY** — Approved message opened via native SMS with recipient and text pre-filled. Counselor or secretary sends and marks as sent.

**SPEAK** — Day after the meeting, app sends in-app confirmation prompt to all bishopric. Any issue flagged opens a comment thread.

**APPRECIATE** — Bishopric members submit brief personal comments about each speaker, in the comment thread on that assignment. Those comments are what the thank-you is built from, and both the AI draft and the plain template draw on them. **With no comments recorded, no message is offered at all** — by this stage the speaker has usually been thanked in person, and a generic text afterwards subtracts from that rather than adding to it; the stage can still be marked done. Conducting counselor reviews, approves, and sends (or delegates to secretary).

**COMPLETE** — Thank you sent and Sunday confirmed. Assignment closed.

### Prayer Rotation
- Opening and closing prayer assignments tracked alongside talks
- Simplified pipeline: Assign → Ask → Confirm → Done
- Rotation tracked to ensure variety
- Names feed into the program builder

### Speaker Reliability Profile
Each member has an assignment history tab visible to the bishopric:
- Date, assignment type, outcome, cancellation notice given, counselor notes
- Pattern flags: declined 2+ times, cancelled within 1 week, not asked in 18+ months, not spoken in 2+ years
- Flags are informational only

---

## Module 4: Topic Library

- Pre-loaded base library of evergreen gospel topics at setup
- Topics can be added manually, AI-generated, or edited/archived by any bishopric member
- AI suggestions are proposed — not auto-added — and require bishopric acceptance before entering the library
- Each topic includes: title, category, description, suggested scriptures, suggested General Conference talks
- Categories: `Doctrinal`, `Scriptural`, `Conference Talk`, `Seasonal`, `Custom`
- Rotation tracking: last assigned date shown alongside each topic when planning

---

## Module 5: Knowledge Base

A library of reference documents that AI draws from when generating topic suggestions, scripture references, and conference talk recommendations.

### Pre-loaded at Setup
- Old Testament, New Testament, Book of Mormon, Doctrine & Covenants, Pearl of Great Price

### Additional Documents (uploaded by bishopric)
- General Conference talks (added after each conference)
- Any other reference material (ward theme documents, First Presidency letters, etc.)

### How It Works
- Documents are chunked and embedded using pgvector at upload time
- At query time, the app performs semantic search to retrieve the most relevant passages
- Only retrieved excerpts are sent to Claude — not full documents
- Suggestions cite their source (e.g. "Alma 32:21", "Elder Holland, April 2024")

### Document Management
- Upload, tag, activate/deactivate, and delete documents
- Accessible by all three bishopric members
- Tags: `Standard Works`, `General Conference`, `Other`
- A **General Conference** upload also records the speaker, the calling they held **at the time
  of the talk**, and which conference it came from. These are required for that tag and hidden
  for every other, because they are what the scoping controls below filter on.
- A conference talk missing them is badged **"Not filterable"** — no scope can narrow it, so it
  is searched every time however tightly the ward has scoped things. That is the opposite of what
  the words suggest, so the list says what it means.
- A whole conference can be loaded at once from the command line with
  `npm run knowledge:ingest-conference`, which fills the speaker and date for every talk. This is
  **human-triggered only** — there is no scheduled fetch, and nothing is downloaded from anywhere
  (see CLAUDE.md §9).

### Choosing Which Conference Talks Count as Reference

Five volumes of scripture need no management. A hundred and fifty conference talks do, and
activating them one at a time is not a lever anybody would use.

The bishopric sets a scope **once** and every suggestion from then on respects it, with nothing
further to press:

- **How far back to look** — a single choice: no limit, or the last 2, 5, or 10 years.
- **Callings** — checkboxes. **None ticked means no restriction**, and the panel says so; an empty
  checkbox group that silently means "everything" is a trap.
- **Saved filters** — filters the ward taught the app in its own words (below), ticked on and off.

Everything narrows **together**: a ticked filter applies on top of the callings and the period,
not instead of them.

Under the three controls sits the sentence that makes the whole feature honest:

> Currently scoped to 47 of 152 conference talks. The standard works are always included.

**The standard works are never filtered.** A recency setting narrows conference talks and nothing
else — scripture, stake letters and anything untagged are always searched. That sentence is the
only place a person can see it, and it is the difference between a bishopric that trusts the panel
and one that quietly wonders whether it broke their suggestions.

A scope matching **no** talks is a legitimate choice, not an error. The panel says what will
happen: suggestions fall back to the standard works alone.

### Teaching It a Filter

Type what you are after in plain words — *"talks by President Nelson"*, *"anything from the last
five years"* — and the app works out a filter, **shows you the sentence it produced**, and saves
nothing until you accept it. The phrase you typed is kept alongside the filter, because six months
later it is the only thing that explains what the filter is for.

Two things it will refuse, and both refusals teach rather than block:

- **A subject** — *"talks about the temple"*. Searching by subject is what already happens on
  every single search. A filter would narrow nothing and mislead.
- **Anything it cannot turn into a speaker, a calling, or a period.**

Saved filters are created and deleted, never edited: editing one would silently change what every
past suggestion meant.

### Trying a Search

The retrieval tester shows exactly what the AI receives. By default it searches **using the ward's
scope**, which is the honest preview; untick that to search everything, which is more useful while
deciding what the scope should be.

---

## Module 6: AI Settings & Behavior Configuration

*Accessible by all three bishopric members.*

A plain-English configuration panel defining how Claude behaves throughout the app. Settings are assembled into a system prompt prepended to every API call.

### Configuration Sections
- **Tone & Voice** — how messages should feel
- **Doctrinal Emphasis** — priorities and guardrails
- **Scripture Preferences** — canon priority, quantity, relevance notes
- **Conference Talk Preferences** — recency, quantity, knowledge base priority.
  **This is guidance to the AI about what to prefer among the talks it was given.** Which talks
  are searchable in the first place is set separately, in the Knowledge Base (Module 5) — the two
  are different things, and each screen says so.
- **Topic Generation Preferences** — standing guidance for topic suggestions
- **Ward Context** — demographic and cultural context for the ward
- **Thank You Message Preferences** — style and length guidance

### Preview & Test Panel
Bishop or counselor can run a test prompt to see how current settings affect AI output before going live.

### Settings History
Each save creates a timestamped snapshot. Any prior version can be restored.

---

## Module 7: Sacrament Program Builder

Once speakers, prayers, and hymns are finalized for a Sunday, the app generates the sacrament meeting program as a PDF.

### Program Layout
Based on the standard bifold format (Buffalo Ward template):
- **Cover (outside right):** Church name, ward name, configurable image (e.g. temple silhouette), date
- **Meeting Order (inside right):** Full meeting order with all roles and hymn numbers
- **Leadership Contacts (inside left):** Auto-populated from ward settings; updates when callings change (with confirmation prompt before any auto-update propagates)
- **Back Panel (outside left):** Missionary information and announcements

### Meeting Order Fields
| Field | Source |
|---|---|
| Date | Sunday calendar |
| Presiding | Bishop by default; editable per Sunday |
| Conducting | Conducting rotation |
| Organist | Music coordinator or manual entry |
| Chorister | Music coordinator or manual entry |
| Opening Hymn | Music coordinator selection |
| Invocation | Prayer assignment |
| Ward/Stake Business | Free text (secretary) |
| Sacrament Hymn | Music coordinator selection |
| Special notes | Free text (e.g. "Under direction of Stake Presidency") |
| Musical Number | Music coordinator (if applicable) |
| Closing Hymn | Music coordinator selection |
| Benediction | Prayer assignment |
| Announcements | Free text (secretary) |

### AI-Assisted Program Editing
- Secretary or bishopric member can make program modifications through a conversational AI interface
- User describes the change in plain English; AI updates the program draft accordingly
- All changes visible in the draft before finalizing

### Approval & Distribution
1. Secretary (or bishopric) finalizes the draft
2. PDF sent in-app to bishopric for approval
3. Once approved, secretary sends PDF by email to ward distribution list and librarian
4. Bishopric can complete this entire process if secretary is unavailable

### Public Program Link
- The ward has a persistent public URL — no login required to view. The slug belongs to the **ward**, not to a Sunday: it always shows the most recent program that has been distributed
- **Distribution is what publishes a program**, not approval (`program-c`). An approved program the bishopric has signed off and not yet sent is not yet the congregation's, so the public page shows nothing until it goes out
- Reopening a distributed program as a draft takes the public page **dark** until it is approved and distributed again, rather than showing a version somebody is midway through changing. It does not update in place — the earlier wording said it did, and that was never how the status machine worked (`lib/program/queries.ts`)
- A QR code linking to this URL is embedded in the printed program PDF
- Members without a physical program, visitors, or anyone following along digitally can scan or use a previously shared link
- Design is clean and mobile-optimized

### Template Configuration (Admin)
- Ward name, image, fonts, and layout configurable in ward settings
- Default template matches Buffalo Ward bifold format

---

## Module 8: Music Coordination

### Music Coordinator Capabilities
- View upcoming Sundays and assigned speaker topics
- Search the pre-loaded hymn database (all standard hymns with numbers and titles)
- Receive AI-suggested hymns based on the week's assigned topics
- Select or override suggestions
- Log special musical numbers (performer, piece title)
- All selections feed into the program builder

### AI Hymn Suggestions
- Based on topic(s) assigned for that Sunday
- Pulls from knowledge base where relevant
- Suggestions shown with a one-line note explaining the connection to the topic
- Music coordinator can accept, modify, or ignore suggestions

---

## Module 9: Visit Tracker

Available to all organizations. Each org manages its own visit goals and logs independently. The bishopric can see all orgs' data; org members see only their own (and shared summaries if cross-org visibility is enabled).

### Visit Goal Configuration
- Each org sets its own visit goals (e.g. "visit every family once per year")
- Bishopric: bishop or either counselor can configure
- Other orgs: org president or counselors can configure
- Goals reset on a cadence set by the org (annually or as configured)

### Household Visit Records
- Date, visit type (`In-Home Visit`), conducted by, shared notes, private notes
- **Shared notes** — visible per cross-org visibility settings
- **Private notes** — visible only to the individual who wrote them, always

### Flagging for Ward Council
- Any visit entry can be flagged for ward council discussion
- Flag sends a notification to the executive secretary with a one-line agenda item: "[Org] — [Family Name] — requested for ward council discussion"
- Executive secretary adds it to the next ward council agenda

### Progress Dashboard
- Sortable list: household name, last visited, visit count, status (`Visited`, `Due Soon`, `Overdue`, `Not Yet Visited`), logged by
- Map view (optional toggle): households plotted with color-coded pins by status
- Progress summary banner: "X of Y households visited — Z remaining"

### Cross-Org Visibility
- Configurable by bishopric admin (on/off)
- When on: all org participants can view other orgs' visit summaries and shared-note reports
- When off: each org sees only their own data
- Management of goals and entries always remains confined to the org's own members

### Return & Report Feed
- Tile-based feed of all visit reports
- Each tile shows: org, household/individual, date, who visited, one-line preview of shared note
- Unread tiles visually distinct from read tiles
- Tapping a tile opens the full report and marks it as read
- "Next Unread" button navigates through the unread queue
- Flag icon bookmarks a report for future reference
- "Mark All as Read" option
- Read/unread and flag state are per-user

### Future: Org Discussion Threads
- Data model built to support org-level and ward council discussion threads at launch
- No UI exposed in v1 — framework only, to be activated in a future iteration

---

## Module 10: Youth Activity Support

A tool for tracking secular youth activities (school sports, performances, academic events, community activities) and ensuring someone from the bishopric or ward council shows up to support the youth.

### Youth Activity Profiles
Each youth can have multiple activity profiles:
- Youth (linked from roster), activity/org name, school/organization, activity type, season/schedule, notes, linked calendar

### Calendar Import
- ICS/iCal file upload
- Google Calendar URL sync
- Manual event entry
- Events tagged as `Home`, `Away`, or `TBD` based on location data (editable)

### Coverage Model
- **Home events** — priority for in-person support; bishopric assigns or anyone self-adds as attendee; flagged as uncovered if within 7 days with no one assigned
- **Away events** — awareness only; surfaced in a weekly Monday digest: *"This week: Jake is in Billings for a basketball tournament (Fri–Sat)."*

### Post-Activity Follow-Up
- Attendees prompted after event to confirm attendance and log a brief pastoral note
- Shared notes visible to all bishopric; private notes visible only to the author
- Flag option sends agenda item to executive secretary (same as visit tracker)

### Reporting
- Same return and report feed model as visit tracker
- Tile-based, tap to read, auto-mark read, next unread navigation, flag for later

---

## Module 11: Goals & Reminders Tracker

Simple objectives board for tracking recurring intentions beyond the standard rotation.

- Goals linked to a target (member, household, org, or group)
- Desired frequency, last fulfilled date, status (`On Track`, `Due Soon`, `Overdue`)
- Overdue and due-soon goals surface as a dismissible banner on the Sunday planning page —
  where speakers are actually chosen. They were tried on the month calendar first and taken
  back off: an alert on every cell of every month is a warning nobody reads (talks-d)
- Examples: each quorum presidency speaks once per year, youth speaker twice per quarter, no member goes 2+ years without being asked

---

## Module 12: Meeting Agenda Builder

### Supported Meeting Types
- **Bishopric Meeting** — weekly (configurable)
- **Ward Council** — every other week (configurable)

### Agenda Template Structure
Standing sections (configurable per meeting type):
- Opening / Prayer
- Approval of previous minutes
- Flagged ward council items (auto-populated from visit tracker and youth activity flags)
- Org reports
- Action items (carried forward from previous meeting until marked complete)
- New business
- Closing / Prayer

### Building & Publishing
- Secretary (or bishopric) fills in agenda items for each meeting
- Action items from prior meetings carry forward automatically
- Secretary publishes when ready — triggers email PDF distribution
- Bishopric can build and publish agendas if secretary is unavailable

### Email Distribution
- Each user opts in by default; unsubscribe link in every email
- Admin (any bishopric member) can re-enable a user's subscription
- Scheduled send: PDF emailed at a configured time the day/night before the meeting
- Recipients can also access the agenda in-app at any time

---

## Module 13: Tithing Calculator

*Bishopric access only. Session-based — no data persists beyond the current day.*

A counting worksheet for use during tithing counting sessions. Not a record-keeping tool — official records are maintained in the church's system (MLS/LCR).

### Session Flow
1. One person enters all submissions; second person verifies the summary totals
2. Each envelope is entered as a separate submission with an auto-incremented entry number
3. Entry number can be written on the corresponding slip for traceability

### Entry Form
- **Checks:** repeating rows of check number + amount
- **Bills:** quantity entry per denomination ($100, $50, $20, $10, $5, $2, $1)
- **Coins:** quantity entry per denomination (dollar, half dollar, quarter, dime, nickel, penny)
- Live subtotals shown per section; grand total shown at bottom

### Session Summary
Running totals across all submissions:
- Count of every denomination
- Check total, cash total, coin total, grand total

### Controls
- Save Entry, Edit Entry, Delete Entry
- Clear Current Entry (with confirmation)
- Clear All Entries (with confirmation and warning) — this discards the shared worksheet,
  including entries someone else typed
- Auto-clear 48 hours after the first entry of a worksheet is saved. Later entries do not
  extend the window

### One Shared Worksheet
The bishopric shares a single in-progress count per ward — there is no per-person worksheet.
Entries appear live on every open device, so one person can enter submissions while a second
verifies the totals on their own phone. The count survives a refresh, a logout, and a move to
another device; it ends only when someone clears it or the 48 hours run out.

---

## Module 14: Notification Center

### In-App Only
All notifications are in-app. No email or SMS sent by the app except agenda PDFs and approved program/message distributions.

### Notification Management (Admin)
- Any bishopric member can access the notification management page
- Lists all notification triggers with current recipient configuration
- Toggle any notification on/off globally
- Adjust default recipients per trigger

### User-Level Control
- Each user can opt themselves out of any individual notification
- Opt-out is personal — does not affect other users of the same role
- Admin can re-enable a user's subscription to any notification

---

## Module 15: Admin & Settings

All admin capabilities are shared equally by the bishop and both counselors. Any admin change notifies the other two with a description of what changed and who changed it.

### Ward Settings
- Ward name, meeting times, template image, program layout preferences
- Conducting rotation order and current month
- Organization list (add/configure orgs)
- Meeting schedule configuration (bishopric meeting frequency, ward council frequency)
- Agenda email send time

### User Management
- View all users, roles, and organizations
- Generate invite links (tied to role and org)
- Deactivate accounts, change roles
- Re-enable notification subscriptions

### Role Access Summary Page
- Visual table of all roles and their module access
- Editable in-app by any bishopric member
- Changes notify the other two bishopric members

### Notification Management
- See Module 14

### Leadership Contacts
- Maintained in ward settings; auto-populates the sacrament program
- When a contact changes, a confirmation prompt asks whether to update the program template

### Missionary Information
- Names and addresses of current missionaries (displayed in program back panel)
- Maintained in ward settings

---

## Module 16: Audit Log

Visible to all three bishopric members.

- Timestamped record of every significant action taken in the app
- Fields: user, date/time, action description, module affected
- Filterable by user, date range, and module
- Login and logout events included
- Read-only — cannot be edited or deleted

---

## Module 17: Sacrament Administration

A tool for the assigned youth (priest or teacher quorum member) to manage and distribute sacrament ordinance assignments for each Sunday of the month. Bishopric retains oversight and approval authority.

*Note: The Young Men presidency is fulfilled by the bishopric in this ward. YM is not a separate organization.*

### Access
| Role | Capabilities |
|---|---|
| Bishop / Counselor | Configure rotation patterns, manage youth roster pool, view all assignments, receive notifications |
| Assigned Youth Manager | View and adjust monthly assignments, mark message as sent |
| Public (no login) | View current assignments via public link |

### Youth Account Authentication
Youth accounts use **username + PIN** instead of email + password:
- Username assigned by bishopric admin (e.g. first initial + last name)
- PIN is a 6 digit code set at account creation. (Originally specified as 4–6. Supabase Auth
  enforces a six-character minimum on the password-update call, so a shorter PIN could be
  created but never reset — and a reset is the only way to unblock a locked-out youth. Six
  digits is also the default iPhone passcode length, so it is a familiar shape.)
- No email required — account created entirely by bishopric admin
- PIN resets handled by bishopric admin directly (no email flow)
- Email field is optional on youth accounts

### Assignment Manager Role
- One youth is designated as the active assignment manager at a time
- Designation is open-ended — stays assigned until the bishopric manually changes it
- Bishop or counselor can rotate this responsibility to a different youth at any time
- The designated youth logs in and manages assignments for their active period

### What Gets Assigned Each Sunday
Three rotating assignment types:

| Assignment | Pool | Rule |
|---|---|---|
| Bread blessing | Priests only | Always a different priest than water blessing |
| Water blessing | Priests only | Always a different priest than bread blessing |
| Setup & takedown | Teachers (configurable) | Assigned as a pair |
| Bread provider | Configurable youth pool | Rotated separately |

### Rotation Pattern Configuration (Bishopric)
- Bishop or counselor defines the rotation pool for each assignment type by filtering the youth roster and selecting eligible members
- A rotation order is established (can be alphabetical, by age, or manually ordered)
- The pattern auto-generates a full month of assignments based on the configured order
- Special overrides can be inserted for any Sunday without disrupting the overall rotation (e.g. a newly baptized adult given an opportunity to bless)
- Pattern changes and overrides require no approval flow — bishopric makes them directly

### Assignment Manager Workflow
1. Manager logs in with username + PIN
2. Views the auto-generated month of assignments
3. Makes any needed adjustments (swaps, overrides for unavailability, special circumstances)
4. Sends a message to the youth group via native SMS handoff — message includes the public assignments link
5. Taps "Message sent" to confirm in the app
6. Bishopric notified: *"Sacrament assignments message sent by [Name]"*

### Deadline Reminder
- Bishopric configures a send-by deadline (e.g. "by Thursday, two weeks before the first Sunday")
- If no "message sent" confirmation is logged by the deadline, bishopric receives an in-app alert: *"Sacrament assignments have not been sent yet — follow up with [Manager Name]"*

### Public Assignments Page
- A persistent, publicly accessible URL generated per ward
- No login required — anyone with the link can view
- Always displays the **current** assignments — any edits made in the app are reflected immediately
- Eliminates confusion from multiple versions being texted around
- When assignments change, manager sends a new text noting what was updated; recipients tap any link they have (old or new) and see the latest version

### Public Program Page
- The sacrament meeting program also has a persistent public URL
- Displays the most recently **distributed** program — see Public Program Link above for why distribution rather than approval is the gate
- Editing it again means reopening it as a draft, which takes the page dark until it is re-approved and re-distributed
- A QR code linking to this URL is printed on the physical program
- Visitors, members without a physical program, or anyone who wants to follow along digitally can scan or use a previously shared link
- Both the assignments page and the program page share the same public-facing design — clean, mobile-optimized, no login prompt

### Bishopric Visibility
- Bishopric can view all current and past assignments
- Can see who the active assignment manager is and when they last logged in
- Receives notifications for: message sent confirmation, missed deadline alert
- Can make direct edits to assignments at any time (overriding the manager's view)

---

## Out of Scope for v1

- Email or push notifications (in-app only, except agenda and program PDFs)
- Two-way SMS tracking
- LCR API integration (CSV import only)
- Multi-ward UI (data model supports it; interface does not)
- Public-facing member portal beyond the assignments and program public pages
- Calendar sync with external apps
- Org discussion threads and ward council messaging (data model built; UI deferred)
