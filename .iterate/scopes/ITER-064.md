# ITER-064: Missionaries in the Sacrament Planner

**Type:** Feature
**Status:** Backlogged
**Created:** 2026-11-16

## Summary
Let the bishopric record the ward's current full-time missionaries in the Planner as **missionary
units** (companionships). Each unit is ranked on Who's Next and tracked in history **as a unit**,
not as separate people, while still recording which missionaries took part. Missionaries can be
picked for talks and prayers anywhere the Planner picks people, and print as **Elder** or **Sister**
on the program.

## Context
Raised by the user (2nd counselor) on 2026-11-15/16. Missionaries serving in the ward speak and pray
in sacrament meeting, but they are not on the ward roster and change at every transfer. What the
bishopric needs to know is **when the missionaries last spoke or prayed**, whoever they were at the
time. Who the individual missionary was matters only as a detail.

This stays **separate from ITER-058** (roster decides callings), because missionaries will never come
from the ward roster.

**Today**, the only way to put someone not on the ward list into the Planner's name pickers is
**Added people** on People & bishopric (name, optional age and phone). They then appear in every
picker and on Who's Next as ordinary individuals. Nothing marks them as missionaries, groups them,
or survives a transfer as the same unit.

## Desired Outcome
**Recording the missionaries (People & bishopric → new Missionaries section)**
- The section holds **missionary units** (companionships). A ward may have several.
- Each unit has:
  - a **short name**, free text, which the bishopric chooses (suggested: by area, such as
    "Elders – North" or "Sisters – South")
  - **one phone number** for the companionship
  - **missionary slots, two by default**, with the option to add more or remove some
- Each slot holds a **title (Elder or Sister) and a name**. Names are swapped at transfers.
- A **senior couple** is simply a unit holding an Elder and a Sister.
- **Unit numbers are fixed.** Each unit has a lasting number (1, 2, 3…) behind its name.
  - Removing a unit makes it **inactive** and keeps its history.
  - The next unit added **reuses the lowest free number** and picks up that number's history.
  - **Nothing ever renumbers**, so history never moves from one unit to another.
- With a blank name, a unit shows **"Missionaries"** when it is the only one, and its number when
  there are several.

**Who's Next and finding them**
- Who's Next shows **one entry per active unit**, ranked as due like everyone else by the last time
  **anyone in that unit** spoke or prayed.
- Under the unit's name, the entry shows **who is serving now**, for example
  *Elders – North · Elder Smith & Elder Jones*.
- Typing **"missionary"** in any name picker surfaces the units and their missionaries.

**Picking them (Who's Next, Pray About, placing on a Sunday)**
- Picking a missionary or a unit opens a small window listing that unit's current missionaries:
  - the one tapped is ticked; if the **unit** was tapped, everyone is ticked
  - the window asks whether to add the rest ("Add Sister Lee as well?")
  - picking just one is allowed
- **Each missionary fills their own slot.** Missionaries are **separate speakers** (speaking
  together), and separate prayer-givers when both pray.
- If a Sunday has **too few open slots** for the missionaries picked, the Planner warns and offers a
  button to **add the needed slots**, the same way it already handles this case for others.
- **Any missionary taking part counts as the unit taking part.** That updates the unit's last spoke
  or last prayed.

**History**
- Each record keeps **the unit and the individual missionary by name**. The unit-level "last spoke /
  last prayed" is the main fact shown; the individual is available as a detail.
- Past prayers and talks stay in history under the missionary's name after a transfer.

**Messages and the program**
- Asks, messages and follow-ups for a missionary go to the **unit's one phone number**.
- The program prints **"Elder" or "Sister"** before a missionary's name, never "Brother" or "Sister".

**Done looks like:**
1. The bishopric enters one unit: "Elders", one phone number, and Elder Smith and Elder Jones.
2. On Who's Next, "Elders · Elder Smith & Elder Jones" ranks by the unit's last talk.
3. Tapping it fills two open speaker slots on a Sunday, offering to add a slot if only one is open.
4. The program reads "Elder Smith" and "Elder Jones".
5. After a transfer the names are swapped. The unit keeps its last-spoke date, and the history still
   names Elder Smith on the earlier Sunday.

## Scope Notes
- **The Planner is imported code** (`lib/sacramentPlanner/assets/`), changed only for deliberate,
  user-requested reasons (GROUP-04 / GROUP-06 precedent). This is one, and a larger one than the
  others.
- **New stored data:** the Planner's documents live in `planner_documents` under a fixed set of
  collections, which the save route validates. A missionaries store may need a new collection or a
  new shape inside an existing one; planning decides which. Practice mode must keep working for it.
- **The program title rule** sits beside the existing honorific logic, which today gives "Brother" or
  "Sister" from gender and age. It also interacts with the next backlog item, which drops middle names
  on the program.
- **Who's Next ranking** today is per person. A unit entry is a new kind of row. Planning should check
  that the "due" maths, flags (★), Do Not Ask, deferrals and Pray About all behave sensibly for a
  unit, or deliberately do not apply to one.
- **The existing slot-shortage warning** is the pattern to follow for "not enough open slots", not a
  new one.
- **Imported history:** older program records may already name missionaries ("Elder X") as matched or
  unmatched rows. Attaching those to a unit is **not** part of this item unless planning finds it
  cheap; note it either way.
- **Other wards:** several companionships, sister missionaries and senior couples are all covered by
  the unit model. The user's ward currently has sister missionaries.

## Open Questions
- What does a unit's history show when it was **inactive** for a while, and does an inactive unit
  appear anywhere (for example on People & bishopric only)?
- When a transfer swaps names, should the Planner keep a record of **who served in the unit and when**,
  or is the history of talks and prayers enough?
- Should a missionary unit be eligible for **Do Not Ask**, flags (★) and deferrals the way a person is?
