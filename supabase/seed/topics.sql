-- Base topic library — evergreen sacrament meeting topics, seeded into every ward.
--
-- Titles and descriptions only. suggested_scriptures and suggested_talks are left null on
-- purpose: those are generated and then approved by a human in phase 5
-- (plans/05-ai-platform.md). No AI output is written here, and nothing in this file is a
-- draft awaiting approval — these are plain library entries.

insert into topics (ward_id, title, category, description, source, status)
select
  ward.id,
  library.title,
  library.category,
  library.description,
  'library',
  'active'
from wards ward
cross join (values
  ('The Atonement of Jesus Christ',      'doctrinal',  'The infinite sacrifice of the Savior and what it makes possible for each of us.'),
  ('Faith in Jesus Christ',              'doctrinal',  'Faith as a principle of action and power, not merely belief.'),
  ('Repentance',                         'doctrinal',  'Turning toward God, and the daily nature of change rather than a one-time event.'),
  ('Baptism and Covenants',              'doctrinal',  'The baptismal covenant and what we promise each week when we renew it.'),
  ('The Gift of the Holy Ghost',         'doctrinal',  'Recognizing, inviting, and responding to promptings of the Spirit.'),
  ('The Plan of Salvation',              'doctrinal',  'Where we came from, why we are here, and where we are going.'),
  ('The Resurrection',                   'doctrinal',  'The literal resurrection of Christ and the hope it gives at the graveside.'),
  ('Grace and Divine Help',              'doctrinal',  'The enabling power of grace in ordinary, unfinished lives.'),
  ('The Godhead',                        'doctrinal',  'Three distinct beings, one purpose, and what each means to us personally.'),
  ('Priesthood Authority and Service',   'doctrinal',  'Priesthood as an errand of service rather than a position of rank.'),
  ('Temples and Eternal Families',       'doctrinal',  'Temple covenants, family history, and the binding of generations.'),
  ('The Sabbath Day',                    'doctrinal',  'Keeping the Sabbath as a delight and a sign between us and the Lord.'),
  ('Prayer',                             'doctrinal',  'Honest, persistent prayer — including prayers that seem unanswered.'),
  ('Personal Revelation',                'doctrinal',  'Seeking and recognizing individual guidance without waiting to be told.'),
  ('Agency and Accountability',          'doctrinal',  'The gift of choice and the reality that choices carry consequences.'),
  ('Obedience',                          'doctrinal',  'Obedience born of love and trust rather than fear or habit.'),
  ('Sacrifice and Consecration',         'doctrinal',  'Giving of time, means, and self, and what the Lord does with an offering.'),
  ('Charity, the Pure Love of Christ',   'doctrinal',  'Charity as something bestowed and prayed for, not merely practiced.'),
  ('Forgiving Others',                   'doctrinal',  'Releasing offense, including injuries the offender never acknowledged.'),
  ('Enduring to the End',                'doctrinal',  'Faithful endurance across decades, not merely surviving a crisis.'),

  ('The Book of Mormon',                 'scriptural', 'Its origin, its witness of Christ, and the habit of daily study.'),
  ('The Old Testament',                  'scriptural', 'Covenant, prophecy, and the God of Israel across the ages.'),
  ('The New Testament',                  'scriptural', 'The ministry, teachings, and parables of the Savior.'),
  ('The Doctrine and Covenants',         'scriptural', 'Modern revelation and the establishment of the restored Church.'),
  ('The Sermon on the Mount',            'scriptural', 'The Savior''s pattern for a disciple''s inner life.'),
  ('Parables of the Savior',             'scriptural', 'What the parables ask of the listener, then and now.'),
  ('Studying the Scriptures Daily',      'scriptural', 'Building a study habit that survives a busy season.'),
  ('The Restoration of the Gospel',      'scriptural', 'The First Vision, the Restoration, and continuing revelation.'),
  ('Prophets, Seers, and Revelators',    'scriptural', 'Sustaining living prophets and applying general conference counsel.'),

  ('Missionary Work',                    'custom',     'Sharing the gospel naturally, in ordinary conversation and friendship.'),
  ('Ministering',                        'custom',     'Caring for individuals and families in the Savior''s way.'),
  ('Service in the Ward and Community',  'custom',     'Quiet, consistent service, and noticing who is not there.'),
  ('Unity and Belonging',                'custom',     'Building a congregation where newcomers and long-timers both belong.'),
  ('Marriage and Family Relationships',  'custom',     'Strengthening the relationships closest to home.'),
  ('Teaching Children the Gospel',       'custom',     'Gospel learning in the home, taught by parents rather than outsourced.'),
  ('Strength Through Adversity',         'custom',     'Faith that holds when the trial does not lift.'),
  ('Gratitude',                          'custom',     'Gratitude as a practice in circumstances that do not invite it.'),
  ('Hope and Encouragement',             'custom',     'Hope as a doctrine, not merely an optimistic mood.'),
  ('Work and Self-Reliance',             'custom',     'Provident living, honest work, and caring for the poor.'),
  ('Youth and Rising Generation',        'custom',     'Supporting youth in their covenants, questions, and daily pressures.'),

  ('Easter and the Risen Lord',          'seasonal',   'The Savior''s final week, the Atonement, and the empty tomb.'),
  ('Christmas and the Birth of Christ',  'seasonal',   'The Nativity, gifts of the heart, and the Light of the World.'),
  ('The New Year and New Beginnings',    'seasonal',   'Renewal, goal setting, and the mercy of starting again.'),
  ('Thanksgiving and Gratitude',         'seasonal',   'Counting blessings and giving thanks in every circumstance.')
) as library(title, category, description)
on conflict (ward_id, lower(title)) do nothing;
