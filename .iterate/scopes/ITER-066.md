# ITER-066: Messages window — tabs that fit on a phone, references grouped with their links

**Type:** Modification
**Status:** Backlogged
**Created:** 2026-11-16

## Summary
Two small fixes to the Sacrament Planner's **Messages** window:
- make the buttons at the top readable on a phone held upright
- in the ready-made message to speakers, keep each reference's **title and link together** as one
  clearly separated group

## Context
Raised by the user (2nd counselor) on 2026-11-16 while using the Planner on a phone. The message to
speakers (topic plus references) is copied and pasted into a text. Its layout makes it hard to tell
which link belongs to which title.

## Current Behavior
**The buttons at the top of Messages** (opened from a Sunday's **Messages** button):
- There are three: *Music coordinator*, *Program for executive secretary* and
  *Speakers & prayers follow-up →*.
- The third is a shortcut to the Follow Up tab rather than a tab.
- They sit side by side with long labels and generous padding, so on a phone in portrait they do not
  fit and the labels are cut off.

**The message to speakers** (built on Follow Up for people who accepted) lists a talk's references
like this:

```
• Elder Holland – "The Grandeur of God"
  https://www.churchofjesuschrist.org/...
• Mosiah 3:19
  https://www.churchofjesuschrist.org/...
```

- **There is no blank line between references**, so the next title sits right under the previous
  link and can read as belonging to it.
- **The link is tied to its title only by a two-space indent**, which texting apps usually drop. A
  long link may also be turned into a large preview, pulling it away from its title.
- **The same layout appears in a message to several people**, inside each person's block
  (*NAME · Talk*, Topic, References), with "— — —" between people.

## Desired Outcome
- **The top buttons use smaller text** so all three read in full on a phone in portrait. The names stay
  the same; the user chose smaller text over shorter names.
- **Each reference in a speaker message is its own group:**
  - the **title**
  - the **link directly under it**, with no indent
  - a **blank line** before the next reference

  ```
  Elder Holland – "The Grandeur of God"
  https://www.churchofjesuschrist.org/...

  Mosiah 3:19
  https://www.churchofjesuschrist.org/...
  ```
- **This applies to both speaker messages:** to one person, and to several people (inside each
  person's block).
- **Nothing else changes:** greetings, wording, the music coordinator message and the program message
  stay as they are.
- **Done looks like:**
  - On a phone in portrait, all three buttons read in full.
  - A copied speaker message pasted into a text shows every reference title sitting with its own link.

## Scope Notes
- **The Planner is imported code** (`lib/sacramentPlanner/assets/`), changed only for deliberate,
  user-requested reasons (GROUP-04 / GROUP-06 precedent). This is one.
- **A reference with only a title or only a link** should still read cleanly, with no empty line and no
  repeated text. Today a reference whose title is the link prints the link once.
- **The final check is a real phone:** a pasted text on iOS and Android, since link previews differ
  between them.
- **"Write it fresh with Claude" and "Reword"** produce their own text. Planning should check whether
  they should be told to keep the same title-then-link grouping.

## Open Questions
- None blocking. Confirm on a real phone that the grouping holds up once the texting app turns links
  into previews.
