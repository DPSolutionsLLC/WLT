-- ============================================================================
-- ⚠️  PARTIAL HYMN LIST — NOT THE FULL HYMNBOOK.
--
-- The standard hymnbook contains 341 hymns. This file seeds only the subset whose number
-- and title are known with confidence, because a wrong hymn number prints on a real program
-- that a congregation then sings from.
--
-- The full list MUST be sourced from an authoritative source before
-- plans/06-program-music.md ships hymn selection. Until then, treat an empty lookup as
-- "not seeded yet", not as "no such hymn".
--
-- Do not pad this file with plausible-looking entries. That rule is UNCHANGED, and every row
-- below carries `source = 'authoritative'` to say it was hand-verified.
--
-- The gap is filled elsewhere, not here. `npm run hymns:placeholders` (migration 042,
-- supabase/scripts/hymns.ts) inserts a row for every missing number titled "[Placeholder] Hymn
-- <n>" with `source = 'placeholder'` and no topic tags — obviously synthetic, believable by
-- no one, and deleted in one command when a real hymnbook arrives. Nothing plausible-looking
-- is ever written to this table.
--
-- `source` is NOT NULL with no default, so a row added below that omits it fails loudly. That
-- is intended.
-- ============================================================================

insert into hymns (number, title, topic_tags, source) values
  (2,   'The Spirit of God',                        '{restoration,temple,praise}', 'authoritative'),
  (3,   'Now Let Us Rejoice',                       '{joy,restoration,second_coming}', 'authoritative'),
  (6,   'Redeemer of Israel',                       '{jesus_christ,deliverance,hope}', 'authoritative'),
  (19,  'We Thank Thee, O God, for a Prophet',      '{prophets,gratitude,restoration}', 'authoritative'),
  (21,  'Come, Listen to a Prophet''s Voice',       '{prophets,revelation,obedience}', 'authoritative'),
  (26,  'Joseph Smith''s First Prayer',             '{restoration,prayer,first_vision}', 'authoritative'),
  (27,  'Praise to the Man',                        '{restoration,prophets,joseph_smith}', 'authoritative'),
  (29,  'A Poor Wayfaring Man of Grief',            '{service,charity,jesus_christ}', 'authoritative'),
  (30,  'Come, Come, Ye Saints',                    '{pioneers,perseverance,faith}', 'authoritative'),
  (60,  'Battle Hymn of the Republic',              '{second_coming,truth,patriotic}', 'authoritative'),
  (72,  'Praise to the Lord, the Almighty',         '{praise,worship,god_the_father}', 'authoritative'),
  (85,  'How Firm a Foundation',                    '{faith,trust,scriptures}', 'authoritative'),
  (86,  'How Great Thou Art',                       '{praise,creation,worship}', 'authoritative'),
  (89,  'The Lord Is My Light',                     '{light,guidance,trust}', 'authoritative'),
  (97,  'Lead, Kindly Light',                       '{guidance,faith,trust}', 'authoritative'),
  (100, 'Nearer, My God, to Thee',                  '{devotion,trials,drawing_near}', 'authoritative'),
  (116, 'Come, Follow Me',                          '{discipleship,jesus_christ,obedience}', 'authoritative'),
  (134, 'I Believe in Christ',                      '{testimony,jesus_christ,faith}', 'authoritative'),
  (136, 'I Know That My Redeemer Lives',            '{testimony,resurrection,jesus_christ}', 'authoritative'),
  (152, 'God Be with You Till We Meet Again',       '{farewell,closing,blessing}', 'authoritative'),
  (169, 'As Now We Take the Sacrament',             '{sacrament,covenants,remembrance}', 'authoritative'),
  (170, 'God, Our Father, Hear Us Pray',            '{sacrament,prayer,reverence}', 'authoritative'),
  (172, 'In Humility, Our Savior',                  '{sacrament,humility,atonement}', 'authoritative'),
  (173, 'While of These Emblems We Partake',        '{sacrament,atonement,remembrance}', 'authoritative'),
  (174, 'While of These Emblems We Partake',        '{sacrament,atonement,remembrance}', 'authoritative'),
  (175, 'O God, the Eternal Father',                '{sacrament,covenants,atonement}', 'authoritative'),
  (181, 'Jesus of Nazareth, Savior and King',       '{sacrament,jesus_christ,worship}', 'authoritative'),
  (185, 'Reverently and Meekly Now',                '{sacrament,reverence,atonement}', 'authoritative'),
  (191, 'Behold the Great Redeemer Die',            '{sacrament,atonement,crucifixion}', 'authoritative'),
  (193, 'I Stand All Amazed',                       '{sacrament,atonement,gratitude}', 'authoritative'),
  (194, 'There Is a Green Hill Far Away',           '{sacrament,atonement,crucifixion}', 'authoritative'),
  (195, 'How Great the Wisdom and the Love',        '{sacrament,atonement,plan_of_salvation}', 'authoritative'),
  (196, 'Jesus, Once of Humble Birth',              '{sacrament,jesus_christ,second_coming}', 'authoritative'),
  (197, 'O Savior, Thou Who Wearest a Crown',       '{sacrament,atonement,humility}', 'authoritative'),
  (201, 'Joy to the World',                         '{christmas,second_coming,joy}', 'authoritative'),
  (202, 'Oh, Come, All Ye Faithful',                '{christmas,worship,jesus_christ}', 'authoritative'),
  (204, 'Silent Night',                             '{christmas,reverence,nativity}', 'authoritative'),
  (239, 'Choose the Right',                         '{agency,obedience,youth}', 'authoritative'),
  (241, 'Count Your Blessings',                     '{gratitude,trials,hope}', 'authoritative'),
  (270, 'I''ll Go Where You Want Me to Go',         '{service,missionary_work,obedience}', 'authoritative'),
  (292, 'O My Father',                              '{plan_of_salvation,heavenly_parents,eternal_life}', 'authoritative'),
  (301, 'I Am a Child of God',                      '{children,identity,plan_of_salvation}', 'authoritative')
on conflict (number) do nothing;
