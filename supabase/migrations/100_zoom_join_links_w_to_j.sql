-- Migration 100: STORED ZOOM JOIN LINKS USE /j/, NOT /w/.
--
-- Zoom's registration emails hand out links shaped https://<host>.zoom.us/w/<id>?tk=…&uuid=…. The
-- pool stores the /j/ form of the same link, with everything after the path segment unchanged.
-- `normalizeZoomJoinUrl()` in lib/zoom/joinLinkPaste.ts converts every pasted link from now on;
-- this converts the links already stored. The pattern is the same one, anchored to a zoom.us host,
-- so a /w/ anywhere else in a URL is left alone.
--
-- Links already given to somebody are converted too, so "Show QR code" and "Text it" hand out the
-- /j/ form from now on.
--
-- `zoom_join_links_one_url` is unique on (ward_id, join_url). If a ward already holds both forms
-- of one link, converting would collide with it; that stops the migration with a sentence rather
-- than a bare 23505, because which of the two rows to keep is a person's decision.

do $$
declare
  colliding_count integer;
begin
  select count(*) into colliding_count
  from public.zoom_join_links webinar_form
  join public.zoom_join_links join_form
    on join_form.ward_id = webinar_form.ward_id
   and join_form.join_url = regexp_replace(
         webinar_form.join_url, '^(https://([^\s/?#]+\.)?zoom\.us)/w/', '\1/j/', 'i')
  where webinar_form.join_url ~* '^https://([^\s/?#]+\.)?zoom\.us/w/';

  if colliding_count > 0 then
    raise exception
      'Migration 100: % Zoom link(s) are already in the pool in both their /w/ and /j/ form. Remove one copy of each before converting.',
      colliding_count;
  end if;
end
$$;

update public.zoom_join_links
set join_url = regexp_replace(join_url, '^(https://([^\s/?#]+\.)?zoom\.us)/w/', '\1/j/', 'i')
where join_url ~* '^https://([^\s/?#]+\.)?zoom\.us/w/';
