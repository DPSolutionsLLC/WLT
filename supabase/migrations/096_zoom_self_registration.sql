-- ITER-052, migration 096: ZOOM SELF-REGISTRATION WITH BISHOPRIC APPROVAL.
--
-- A public page, reached by a QR code or a shared link, where anyone can ask for a link to watch
-- the sacrament meeting stream. Once approved — automatically, or by every serving member of the
-- bishopric — they get a personal join link from the SAME pool the bishopric hands out on visits
-- (migration 095). There is no Zoom API (plans/zoom-self-registration.md).
--
-- ---------------------------------------------------------------------------
-- A SIGN-UP IS A REQUEST, NOT AN INVITEE (P1)
-- ---------------------------------------------------------------------------
-- Pending and declined people are not invitees and must never appear on the Invitees list, so a
-- registration is its own table. Approval creates an ordinary `zoom_invitees` row with
-- `source = 'self_registration'`, so the link, the waiting state, the to-do and ITER-054's
-- attendance all reuse ITER-053's one mechanism. The link between the two is ONE column,
-- `zoom_registrations.invitee_id` — one direction, one source of truth.
--
-- ---------------------------------------------------------------------------
-- A SELECT POLICY AND NO WRITE POLICY, ON EVERY NEW TABLE
-- ---------------------------------------------------------------------------
-- 095's shape. Every write is the service role: the public submit behind
-- POST /api/public/zoom-registrations (validation, honeypot, caps), and the bishopric's behind
-- canManageInvitees() / canManageRegistrationQuestions(). Do not add a write policy "for
-- convenience" (CLAUDE.md §9, 060-D2). The readers are the bishopric, the ward clerk and the
-- executive secretary — the holders of `zoom.view`.
--
-- ---------------------------------------------------------------------------
-- NOTHING UNDER app/public/ TOUCHES THE SERVICE ROLE (P5)
-- ---------------------------------------------------------------------------
-- The two public READS are security definer functions granted to anon that return narrow shapes:
-- zoom_registration_form() and zoom_registration_status(). The public WRITE is a route handler,
-- not an RPC: a write function granted to anon would let anyone skip the route's limits by
-- calling it directly with the public anon key.
--
-- ---------------------------------------------------------------------------
-- THE STATUS TOKEN (P6)
-- ---------------------------------------------------------------------------
-- 32 random bytes, base64url (43 characters), held only by the registrant. Only its SHA-256 is
-- stored, so a leaked row cannot open anybody's status page. `status_token_hash` is hidden from
-- `authenticated` by a column grant, as `join_url` is: `select("*")` on zoom_registrations through
-- a user's client is a 42501 — name your columns. The referral code is a separate short code, so
-- sharing a referral link can never share a person's own Zoom link.
--
-- ---------------------------------------------------------------------------
-- APPROVAL IS UNANIMOUS AND IS ONE FUNCTION (P2, P3)
-- ---------------------------------------------------------------------------
-- "Every serving member of the bishopric" is read from ward_role_assignments at the moment of each
-- response: a vacant position is simply absent, and a calling released while a request waits
-- drops out with no write. supabase-js has no transactions, so status, invitee row and link land
-- together in approve_zoom_registration(), called both by the last approval and by auto-approve.
--
-- Every user FK is single-column `on delete set null`, never composite (ward-callings-model, 069).


-- 096a. public_pages gains a third page type ------------------------------------------------------
-- An inline CHECK, so it is named public_pages_page_type_check. Both public views filter on their
-- own page_type ('program', 'sacrament_assignments'), so the new type cannot leak into either.

alter table public_pages drop constraint public_pages_page_type_check;
alter table public_pages add constraint public_pages_page_type_check
  check (page_type in ('sacrament_assignments', 'program', 'zoom_registration'));


-- 096b. zoom_registration_settings — one row per ward ---------------------------------------------
-- `email_bishopric_on_new` matters only when auto-approve is on; with approvals on the bishopric is
-- always emailed (z3c).

create table zoom_registration_settings (
  ward_id                uuid        primary key references wards (id) on delete cascade,
  is_open                boolean     not null default false,
  auto_approve           boolean     not null default false,
  email_bishopric_on_new boolean     not null default true,
  updated_by             uuid        references users (id) on delete set null,
  updated_at             timestamptz not null default now(),
  created_at             timestamptz not null default now()
);

comment on table zoom_registration_settings is
  'Whether the ward''s public Zoom sign-up page is open, and how sign-ups are approved (ITER-052).';


-- 096c. zoom_registration_questions — the ward's own questions (P8) --------------------------------
-- Soft-off with is_active, never deleted: an answer already given refers to the question's
-- wording at the time, which the registration keeps as a snapshot anyway.

create table zoom_registration_questions (
  id          uuid        primary key default gen_random_uuid(),
  ward_id     uuid        not null references wards (id) on delete cascade,
  prompt      text        not null check (length(btrim(prompt)) between 1 and 200),
  kind        text        not null check (kind in ('yes_no', 'short_text')),
  audience    text        not null check (audience in ('everyone', 'members', 'non_members')),
  is_required boolean     not null default false,
  position    integer     not null,
  is_active   boolean     not null default true,
  created_by  uuid        references users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, ward_id)
);

create index zoom_registration_questions_ward_position_idx
  on zoom_registration_questions (ward_id, position);


-- 096d. zoom_invitees becomes composite-referenceable, and gains a source --------------------------

alter table zoom_invitees add constraint zoom_invitees_id_ward_id_key unique (id, ward_id);

alter table zoom_invitees drop constraint zoom_invitees_source_check;
alter table zoom_invitees add constraint zoom_invitees_source_check
  check (source in ('visit', 'self_registration'));


-- 096e. zoom_registrations — one request ----------------------------------------------------------
-- `answers` is a SNAPSHOT: [{questionId, prompt, kind, answer}], so editing a question never
-- rewrites what somebody answered. `decline_note` is the bishopric's alone — never shown to the
-- registrant, never audited (writeAuditLog() redacts any key containing "note" in any case).
-- `decided_by` is null when the request was approved automatically.

create table zoom_registrations (
  id                          uuid        primary key default gen_random_uuid(),
  ward_id                     uuid        not null references wards (id) on delete cascade,
  display_name                text        not null check (length(btrim(display_name)) between 1 and 120),
  phone                       text        not null check (char_length(phone) between 7 and 40),
  phone_digits                text        not null check (phone_digits ~ '^[0-9]{7,20}$'),
  email                       text        check (email is null or (
                                email = lower(email)
                                and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
                                and char_length(email) <= 254)),
  says_member                 boolean     not null,
  answers                     jsonb       not null default '[]'::jsonb
                                check (jsonb_typeof(answers) = 'array'),
  status                      text        not null default 'pending'
                                check (status in ('pending', 'approved', 'declined')),
  held_reason                 text        check (held_reason is null
                                or held_reason in ('approvals_on', 'daily_limit', 'same_phone')),
  status_token_hash           text        not null unique check (status_token_hash ~ '^[0-9a-f]{64}$'),
  referral_code               text        not null unique check (referral_code ~ '^[A-Za-z0-9]{10}$'),
  referred_by_registration_id uuid,
  member_id                   uuid,
  matched_by                  uuid        references users (id) on delete set null,
  matched_at                  timestamptz,
  decided_by                  uuid        references users (id) on delete set null,
  decided_at                  timestamptz,
  decline_note                text        check (decline_note is null or length(decline_note) <= 500),
  invitee_id                  uuid        unique,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (id, ward_id),
  constraint zoom_registrations_decided check ((status = 'pending') = (decided_at is null)),
  constraint zoom_registrations_invitee check (invitee_id is null or status = 'approved'),
  foreign key (member_id, ward_id) references members (id, ward_id)
    on delete set null (member_id),
  foreign key (referred_by_registration_id, ward_id) references zoom_registrations (id, ward_id)
    on delete set null (referred_by_registration_id),
  foreign key (invitee_id, ward_id) references zoom_invitees (id, ward_id)
);

comment on table zoom_registrations is
  'A public request for a Zoom stream link (ITER-052). authenticated may not SELECT '
  'status_token_hash: name your columns, never select("*").';

create index zoom_registrations_ward_created_idx on zoom_registrations (ward_id, created_at desc);
create index zoom_registrations_ward_phone_idx on zoom_registrations (ward_id, phone_digits);
create index zoom_registrations_ward_status_idx on zoom_registrations (ward_id, status);


-- 096f. zoom_registration_responses — each bishopric member's answer (z3b) -------------------------
-- Created now so z3b needs no migration. A decline is not a response row: any one member may
-- decline, and that decides the request outright.

create table zoom_registration_responses (
  registration_id uuid        not null,
  ward_id         uuid        not null,
  user_id         uuid        not null references users (id) on delete cascade,
  response        text        not null check (response in ('approve', 'talk_first')),
  responded_at    timestamptz not null default now(),
  primary key (registration_id, user_id),
  foreign key (registration_id, ward_id) references zoom_registrations (id, ward_id)
    on delete cascade
);


-- 096g. todos.zoom_registration_id — "Match ___ to the roster" (z3b) -------------------------------

alter table todos add column zoom_registration_id uuid
  references zoom_registrations (id) on delete set null;

comment on column todos.zoom_registration_id is
  'The Zoom sign-up this to-do is about (ITER-052). Null on every other to-do.';

create unique index todos_one_open_zoom_registration_todo_per_owner
  on todos (zoom_registration_id, user_id)
  where zoom_registration_id is not null and completed_at is null;

create index todos_zoom_registration_idx on todos (zoom_registration_id)
  where zoom_registration_id is not null;


-- Grants and policies -----------------------------------------------------------------------------

alter table zoom_registration_settings  enable row level security;
alter table zoom_registration_questions enable row level security;
alter table zoom_registrations          enable row level security;
alter table zoom_registration_responses enable row level security;

revoke all on zoom_registration_settings  from anon;
revoke all on zoom_registration_questions from anon;
revoke all on zoom_registrations          from anon;
revoke all on zoom_registration_responses from anon;

-- Column-level SELECT on zoom_registrations: everything but status_token_hash. The write grants a
-- new table gets are left alone — with no write policy, RLS refuses every write anyway.
revoke select on zoom_registrations from authenticated;
grant select (
  id, ward_id, display_name, phone, phone_digits, email, says_member, answers, status,
  held_reason, referral_code, referred_by_registration_id, member_id, matched_by, matched_at,
  decided_by, decided_at, decline_note, invitee_id, created_at, updated_at
) on zoom_registrations to authenticated;

create policy zoom_registration_settings_select on zoom_registration_settings
  for select to authenticated
  using (ward_id = current_ward_id()
         and (is_bishopric()
              or current_user_role() in ('ward_secretary', 'executive_secretary')));

create policy zoom_registration_questions_select on zoom_registration_questions
  for select to authenticated
  using (ward_id = current_ward_id()
         and (is_bishopric()
              or current_user_role() in ('ward_secretary', 'executive_secretary')));

create policy zoom_registrations_select on zoom_registrations
  for select to authenticated
  using (ward_id = current_ward_id()
         and (is_bishopric()
              or current_user_role() in ('ward_secretary', 'executive_secretary')));

create policy zoom_registration_responses_select on zoom_registration_responses
  for select to authenticated
  using (ward_id = current_ward_id()
         and (is_bishopric()
              or current_user_role() in ('ward_secretary', 'executive_secretary')));

create policy zoom_registration_settings_module_released on zoom_registration_settings
  as restrictive for all to authenticated
  using ((select ward_module_released('zoom')))
  with check ((select ward_module_released('zoom')));

create policy zoom_registration_questions_module_released on zoom_registration_questions
  as restrictive for all to authenticated
  using ((select ward_module_released('zoom')))
  with check ((select ward_module_released('zoom')));

create policy zoom_registrations_module_released on zoom_registrations
  as restrictive for all to authenticated
  using ((select ward_module_released('zoom')))
  with check ((select ward_module_released('zoom')));

create policy zoom_registration_responses_module_released on zoom_registration_responses
  as restrictive for all to authenticated
  using ((select ward_module_released('zoom')))
  with check ((select ward_module_released('zoom')));


-- zoom_registration_form (P5) — the public form's one read ------------------------------------------
-- Answers only for an ACTIVE public_pages row of type 'zoom_registration'. A program slug, an
-- inactive slug and an unknown one all return no row: one outcome for every way of not existing
-- (program-c). `is_open` is false when the ward closed sign-ups OR has not released Zoom — anon has
-- no session, so ward_module_released() cannot answer and ward_release_settings is read directly
-- (no row = everything released). Returns the ward's name and its active questions, nothing else.

create function zoom_registration_form(p_slug text)
  returns table (ward_name text, is_open boolean, questions jsonb)
  language sql
  stable
  security definer
  set search_path = public, extensions, pg_temp
as $$
  select
    w.name,
    coalesce(s.is_open, false)
      and (r.ward_id is null or 'zoom' = any (r.released_modules)),
    coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'id', q.id,
                  'prompt', q.prompt,
                  'kind', q.kind,
                  'audience', q.audience,
                  'is_required', q.is_required)
                order by q.position, q.created_at)
         from zoom_registration_questions q
        where q.ward_id = p.ward_id
          and q.is_active),
      '[]'::jsonb)
    from public_pages p
    join wards w on w.id = p.ward_id
    left join zoom_registration_settings s on s.ward_id = p.ward_id
    left join ward_release_settings r on r.ward_id = p.ward_id
   where p.slug = p_slug
     and p.page_type = 'zoom_registration'
     and p.is_active;
$$;

revoke all on function zoom_registration_form(text) from public;
grant execute on function zoom_registration_form(text) to anon;
grant execute on function zoom_registration_form(text) to authenticated;
grant execute on function zoom_registration_form(text) to service_role;


-- zoom_registration_status (P5, P6) — the registrant's own status page -----------------------------
-- Looked up by the token's SHA-256. A token that is not 43 base64url characters is refused before
-- hashing. `join_url` is non-null only when the request is approved and the invitee holds a link.
-- Never returns phone, email, answers, notes or anybody else's data.

create function zoom_registration_status(p_token text)
  returns table (
    slug text,
    ward_name text,
    display_name text,
    status text,
    link_given boolean,
    join_url text,
    referral_code text
  )
  language plpgsql
  stable
  security definer
  set search_path = public, extensions, pg_temp
as $$
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return;
  end if;

  return query
  select
    (select p.slug
       from public_pages p
      where p.ward_id = reg.ward_id
        and p.page_type = 'zoom_registration'
        and p.is_active
      order by p.created_at
      limit 1),
    w.name,
    reg.display_name,
    reg.status,
    (reg.status = 'approved' and inv.join_link_id is not null),
    case when reg.status = 'approved' then link.join_url else null end,
    reg.referral_code
    from zoom_registrations reg
    join wards w on w.id = reg.ward_id
    left join zoom_invitees inv on inv.id = reg.invitee_id and inv.ward_id = reg.ward_id
    left join zoom_join_links link on link.id = inv.join_link_id and link.ward_id = reg.ward_id
   where reg.status_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
end;
$$;

revoke all on function zoom_registration_status(text) from public;
grant execute on function zoom_registration_status(text) to anon;
grant execute on function zoom_registration_status(text) to authenticated;
grant execute on function zoom_registration_status(text) to service_role;


-- approve_zoom_registration (P3) — status, invitee row and link together ----------------------------
-- Locks the registration; a request that is no longer pending returns no row (idempotent). The
-- invitee's `assigned_by` is whoever decided — null when it was approved automatically. A null
-- join_link_id means the pool was empty: the person is approved and waits for a link.

create function approve_zoom_registration(
  p_ward_id uuid,
  p_registration_id uuid,
  p_decided_by uuid
)
  returns table (invitee_id uuid, join_link_id uuid)
  language plpgsql
  security definer
  set search_path = public, extensions, pg_temp
as $$
declare
  v_registration zoom_registrations%rowtype;
  v_invitee_id uuid;
  v_link_id uuid;
begin
  select * into v_registration
    from zoom_registrations
   where id = p_registration_id
     and ward_id = p_ward_id
   for update;

  if not found or v_registration.status <> 'pending' then
    return;
  end if;

  insert into zoom_invitees (ward_id, display_name, member_id, phone, email, source, assigned_by)
  values (p_ward_id, v_registration.display_name, v_registration.member_id,
          v_registration.phone, v_registration.email, 'self_registration', p_decided_by)
  returning id into v_invitee_id;

  update zoom_registrations
     set status = 'approved',
         decided_by = p_decided_by,
         decided_at = now(),
         invitee_id = v_invitee_id,
         held_reason = null,
         updated_at = now()
   where id = p_registration_id
     and ward_id = p_ward_id;

  v_link_id := assign_next_zoom_link(p_ward_id, v_invitee_id);

  invitee_id := v_invitee_id;
  join_link_id := v_link_id;
  return next;
end;
$$;

revoke all on function approve_zoom_registration(uuid, uuid, uuid) from public;
revoke all on function approve_zoom_registration(uuid, uuid, uuid) from anon;
revoke all on function approve_zoom_registration(uuid, uuid, uuid) from authenticated;
grant execute on function approve_zoom_registration(uuid, uuid, uuid) to service_role;


-- respond_to_zoom_registration (P2, z3b) — one bishopric member's answer ----------------------------
-- 'approve' / 'talk_first' upsert the member's response; 'finish' writes nothing and only re-runs
-- the check (for when a calling was released while the request waited). `required` is every
-- active bishopric calling in the ward on an active account; once every one of them has approved
-- (and at least one approval exists) the request is approved in the same transaction. The route
-- has already checked canManageInvitees(), so p_user_id is a bishopric member of this ward.

create function respond_to_zoom_registration(
  p_ward_id uuid,
  p_registration_id uuid,
  p_user_id uuid,
  p_response text
)
  returns table (status text, invitee_id uuid, join_link_id uuid, waiting_on uuid[])
  language plpgsql
  security definer
  set search_path = public, extensions, pg_temp
as $$
declare
  v_status text;
  v_waiting uuid[];
  v_approvals integer;
  v_invitee_id uuid;
  v_link_id uuid;
begin
  if p_response not in ('approve', 'talk_first', 'finish') then
    raise exception 'Unknown response %', p_response using errcode = '22023';
  end if;

  select r.status into v_status
    from zoom_registrations r
   where r.id = p_registration_id
     and r.ward_id = p_ward_id
   for update;

  if not found or v_status <> 'pending' then
    return;
  end if;

  if p_response in ('approve', 'talk_first') then
    insert into zoom_registration_responses (registration_id, ward_id, user_id, response)
    values (p_registration_id, p_ward_id, p_user_id, p_response)
    on conflict (registration_id, user_id)
    do update set response = excluded.response, responded_at = now();
  end if;

  select coalesce(array_agg(distinct a.user_id), '{}')
    into v_waiting
    from ward_role_assignments a
    join users u on u.id = a.user_id and u.is_active
   where a.ward_id = p_ward_id
     and a.is_active
     and a.role in ('bishop', 'counselor')
     and not exists (
           select 1
             from zoom_registration_responses resp
            where resp.registration_id = p_registration_id
              and resp.user_id = a.user_id
              and resp.response = 'approve');

  select count(*) into v_approvals
    from zoom_registration_responses resp
   where resp.registration_id = p_registration_id
     and resp.response = 'approve';

  if cardinality(v_waiting) = 0 and v_approvals > 0 then
    select a.invitee_id, a.join_link_id into v_invitee_id, v_link_id
      from approve_zoom_registration(p_ward_id, p_registration_id, p_user_id) a;
    status := 'approved';
  else
    status := 'pending';
  end if;

  invitee_id := v_invitee_id;
  join_link_id := v_link_id;
  waiting_on := v_waiting;
  return next;
end;
$$;

revoke all on function respond_to_zoom_registration(uuid, uuid, uuid, text) from public;
revoke all on function respond_to_zoom_registration(uuid, uuid, uuid, text) from anon;
revoke all on function respond_to_zoom_registration(uuid, uuid, uuid, text) from authenticated;
grant execute on function respond_to_zoom_registration(uuid, uuid, uuid, text) to service_role;
