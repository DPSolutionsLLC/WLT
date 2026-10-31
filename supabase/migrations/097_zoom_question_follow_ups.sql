-- 097 — ZOOM SIGN-UP FOLLOW-UP QUESTIONS (ITER-052, decided walking scenario 097, 2026-10-30)
--
-- A question can be a FOLLOW-UP to a yes/no question: it is asked only when that question is
-- answered Yes. The reason it exists: the missionary question. "We don't need an address unless they
-- want to meet with the missionaries", so the address is asked of exactly those people and nobody
-- else.
--
-- Null means an ordinary question, asked whenever its audience matches (the absent-means-default
-- idiom). The link is composite with ward_id, so a follow-up can never point at another ward's
-- question.
--
-- What a CHECK cannot see, and lib/zoom/registrationQuestions.ts enforces before every write: the
-- parent must be a YES/NO question, and must not itself be a follow-up (one level only). The public
-- form and the submit route both decide what is asked through one pure function,
-- questionsFor() in lib/zoom/registrationAnswers.ts: a follow-up whose parent is turned off, not
-- asked of this person, or not answered Yes is not asked, and an answer sent to it anyway is not
-- stored.
--
-- No backfill. No ward outside the harness has set up sign-ups yet; setUpRegistration() adds the
-- address follow-up to every page set up from now on.

-- 097a — the link ---------------------------------------------------------------------------------

alter table zoom_registration_questions
  add column shown_when_yes_to uuid,
  add constraint zoom_registration_questions_not_own_follow_up
    check (shown_when_yes_to is null or shown_when_yes_to <> id),
  add constraint zoom_registration_questions_shown_when_yes_to_fkey
    foreign key (shown_when_yes_to, ward_id) references zoom_registration_questions (id, ward_id)
    on delete set null (shown_when_yes_to);

create index zoom_registration_questions_shown_when_yes_to_idx
  on zoom_registration_questions (shown_when_yes_to)
  where shown_when_yes_to is not null;

comment on column zoom_registration_questions.shown_when_yes_to is
  'A follow-up: asked only when this yes/no question is answered Yes. Null = an ordinary question.';

-- 097b — the public form returns it -----------------------------------------------------------------
-- The same function as 096, with one more key per question. The return type is unchanged (jsonb), so
-- this replaces it in place and keeps 096's grants.

create or replace function zoom_registration_form(p_slug text)
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
                  'is_required', q.is_required,
                  'shown_when_yes_to', q.shown_when_yes_to)
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
