# ITER-067: Save a Zoom QR code as a PNG, and general invites with a ready-made message

**Type:** Modification
**Status:** Backlogged
**Created:** 2026-11-16

## Summary
On the Zoom module's link hand-out:
- let any QR code be **downloaded as a PNG**
- add a **General invite** switch with an **event name**, for a link that will be shared with many
  people (such as the Primary program)
- show an **editable ready-made message** beside a general invite's QR code, explaining what it is
  for, ready to copy

## Context
Raised by the user (2nd counselor) on 2026-11-16. The ward mostly gives each person their own stream
link, but some events (the upcoming Primary program, for one) call for **one general invite** that is
printed in physical programs, emailed or texted widely. The user created one by hand, naming the
invitee "General – Primary Program", and needs:
- the QR code as an image to place on printed material
- a short message to sit beside it

Eventually the app's own printed program will carry this. For now, a download is enough.

## Current Behavior
- An invitee's link is handed over from **LinkHandoff** with Text it / Share / Email it /
  **Show QR code**.
- **Show QR code** draws the code in the browser (black on white, quiet zone, 320px raster) and
  **displays it on screen only**, captioned "Have them scan this with their phone camera."
  - There is **no download**.
  - There is **no message** with it.
- The app has **no concept of a general link**. A "General – Primary Program" invitee is an ordinary
  invitee with a typed name, holding one link from the pool.
- Every pool link is a **personal Zoom registrant link** pasted by hand. The app has no Zoom API
  access.

## Desired Outcome
- **Download (PNG)** beside every Show QR code, for any invitee:
  - The image is **only the QR code**, at print quality, so it can be placed on any program or flyer
    with the user's own layout.
  - It must still scan reliably when printed small: keep the existing black-on-white, error-correction
    and quiet-zone rules, at a resolution suitable for print.
  - The file name is sensible (event or invitee name, not a raw id).
- **General invite switch** with an **event name**:
  - Set **when the invitee is created**, or later by **editing** an existing invitee (the existing
    "General – Primary Program" one must be convertible).
  - Meaning: "this link will be shared with many people".
- **Ready-made message for a general invite**, shown beside its QR code:
  - Built from the event name. It says what the code is for (for example, "Scan to watch the Primary
    Program on Zoom") and invites people to share it with anyone who would like to come closer to the
    Savior.
  - **Editable** before copying.
  - **Copy** puts it on the clipboard.
- **General invites are marked** on the Invitees list, so they read as events rather than people.
- **Done looks like:** the user switches "General – Primary Program" to a general invite named
  "Primary Program", opens Show QR code, downloads a PNG that scans when printed in a program, and
  copies a ready-made message (edited if wanted) to place beside it.

## Scope Notes
- **⚠️ An untested assumption, accepted by the user.** A pool link is a personal registrant link, and
  Zoom may allow it on **only one device at a time**, depending on the account's "join from multiple
  devices" setting. If so, a second viewer scanning a printed code can drop the first. The user chose
  to **build it now and test it**.
  - If it fails, the planned fix is to change **which link a general invite hands out** (for example,
    a different kind of Zoom link).
  - The switch, the download and the message are meant to survive that change.
  - Planning should keep "which link a general invite uses" in one place, so it can change.
- **Security rules from ITER-053 still apply:**
  - A join URL reaches the browser only through the existing hand-out routes.
  - It is never in an audit row, and never stored in the browser.
  - A downloaded PNG is the leader deliberately saving it; that is the purpose and is fine.
  - The general-invite switch and event name are ordinary invitee fields: the audit row names the
    changed **fields**, never their values (D3).
- **Attendance (ITER-054)** attaches to an invitee. Many viewers on one general invite will count as
  one invitee; planning should note how a general invite reads in attendance.
- **A general invite and the "Give ___ a Zoom link" to-do:** a waiting general invite may not need a
  to-do worded for a person. Planning checks the wording.
- **The ready-made message is a fixed template**, not AI. It stays editable, and nothing is sent
  automatically.
- **The public sign-up page's QR code** (ITER-052) already exists for printing and gives everyone their
  own link after signing up. It is an alternative for printed programs, not a replacement for this item.
- **Not in scope:** putting the code into the app's own printed program (later), and any Zoom API work.

## Open Questions
- Should the download also be offered for the **sign-up page's QR code** in Registration settings, for
  consistency?
- Should a general invite's hand-out still offer **Text it / Email it** as for a person, or lead with
  the QR code and message?
