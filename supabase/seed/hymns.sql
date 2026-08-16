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
-- Do not pad this file with plausible-looking entries.
-- ============================================================================

insert into hymns (number, title, topic_tags) values
  (2,   'The Spirit of God',                        '{restoration,temple,praise}'),
  (3,   'Now Let Us Rejoice',                       '{joy,restoration,second_coming}'),
  (6,   'Redeemer of Israel',                       '{jesus_christ,deliverance,hope}'),
  (19,  'We Thank Thee, O God, for a Prophet',      '{prophets,gratitude,restoration}'),
  (21,  'Come, Listen to a Prophet''s Voice',       '{prophets,revelation,obedience}'),
  (26,  'Joseph Smith''s First Prayer',             '{restoration,prayer,first_vision}'),
  (27,  'Praise to the Man',                        '{restoration,prophets,joseph_smith}'),
  (29,  'A Poor Wayfaring Man of Grief',            '{service,charity,jesus_christ}'),
  (30,  'Come, Come, Ye Saints',                    '{pioneers,perseverance,faith}'),
  (60,  'Battle Hymn of the Republic',              '{second_coming,truth,patriotic}'),
  (72,  'Praise to the Lord, the Almighty',         '{praise,worship,god_the_father}'),
  (85,  'How Firm a Foundation',                    '{faith,trust,scriptures}'),
  (86,  'How Great Thou Art',                       '{praise,creation,worship}'),
  (89,  'The Lord Is My Light',                     '{light,guidance,trust}'),
  (97,  'Lead, Kindly Light',                       '{guidance,faith,trust}'),
  (100, 'Nearer, My God, to Thee',                  '{devotion,trials,drawing_near}'),
  (116, 'Come, Follow Me',                          '{discipleship,jesus_christ,obedience}'),
  (134, 'I Believe in Christ',                      '{testimony,jesus_christ,faith}'),
  (136, 'I Know That My Redeemer Lives',            '{testimony,resurrection,jesus_christ}'),
  (152, 'God Be with You Till We Meet Again',       '{farewell,closing,blessing}'),
  (169, 'As Now We Take the Sacrament',             '{sacrament,covenants,remembrance}'),
  (170, 'God, Our Father, Hear Us Pray',            '{sacrament,prayer,reverence}'),
  (172, 'In Humility, Our Savior',                  '{sacrament,humility,atonement}'),
  (173, 'While of These Emblems We Partake',        '{sacrament,atonement,remembrance}'),
  (174, 'While of These Emblems We Partake',        '{sacrament,atonement,remembrance}'),
  (175, 'O God, the Eternal Father',                '{sacrament,covenants,atonement}'),
  (181, 'Jesus of Nazareth, Savior and King',       '{sacrament,jesus_christ,worship}'),
  (185, 'Reverently and Meekly Now',                '{sacrament,reverence,atonement}'),
  (191, 'Behold the Great Redeemer Die',            '{sacrament,atonement,crucifixion}'),
  (193, 'I Stand All Amazed',                       '{sacrament,atonement,gratitude}'),
  (194, 'There Is a Green Hill Far Away',           '{sacrament,atonement,crucifixion}'),
  (195, 'How Great the Wisdom and the Love',        '{sacrament,atonement,plan_of_salvation}'),
  (196, 'Jesus, Once of Humble Birth',              '{sacrament,jesus_christ,second_coming}'),
  (197, 'O Savior, Thou Who Wearest a Crown',       '{sacrament,atonement,humility}'),
  (201, 'Joy to the World',                         '{christmas,second_coming,joy}'),
  (202, 'Oh, Come, All Ye Faithful',                '{christmas,worship,jesus_christ}'),
  (204, 'Silent Night',                             '{christmas,reverence,nativity}'),
  (239, 'Choose the Right',                         '{agency,obedience,youth}'),
  (241, 'Count Your Blessings',                     '{gratitude,trials,hope}'),
  (270, 'I''ll Go Where You Want Me to Go',         '{service,missionary_work,obedience}'),
  (292, 'O My Father',                              '{plan_of_salvation,heavenly_parents,eternal_life}'),
  (301, 'I Am a Child of God',                      '{children,identity,plan_of_salvation}')
on conflict (number) do nothing;
