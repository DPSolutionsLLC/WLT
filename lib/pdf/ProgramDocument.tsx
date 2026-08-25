import { Document, Page, View } from "@react-pdf/renderer";
import { BackPanel } from "@/lib/pdf/panels/BackPanel";
import { ContactsPanel } from "@/lib/pdf/panels/ContactsPanel";
import { CoverPanel } from "@/lib/pdf/panels/CoverPanel";
import { MeetingOrderPanel } from "@/lib/pdf/panels/MeetingOrderPanel";
import type { PdfTheme } from "@/lib/pdf/theme";
import type { ProgramDraft } from "@/lib/program/draft";

// ============================================================================================
// IMPOSITION — PANEL ORDER IS NOT READING ORDER
// ============================================================================================
//
// This is 06-program-music.md's first named pitfall and the single most likely thing in this
// feature to be wrong. Read the table before changing anything below it.
//
// One US Letter sheet, landscape (792 x 612pt), printed double-sided and folded once down the
// middle. That gives two sides and four half-sheets of 396 x 612pt:
//
//   SHEET SIDE   LEFT HALF                    RIGHT HALF
//   ----------   --------------------------   ---------------------------
//   Front        BackPanel   (outside left)   CoverPanel        (outside right)
//   Reverse      Contacts    (inside left)    MeetingOrderPanel (inside right)
//
// READING ORDER is cover -> meeting order -> contacts -> back. THE SHEET ORDER IS NOT THAT. The
// cover has to share a side with the back panel, because those are the two faces that end up on
// the outside of the fold.
//
// Fold the front side outward and the cover lands face-up on the right; open it and the reverse
// side presents contacts on the left with the meeting order on the right. That is the object a
// congregation is handed.
//
// --------------------------------------------------------------------------------------------
// THE DUPLEX ASSUMPTION, WHICH IS WHAT A WRONG FOLD WILL TRACE BACK TO
// --------------------------------------------------------------------------------------------
// The reverse-side ordering assumes a duplex printer FLIPPING ON THE LONG EDGE — the standard
// default, and on a landscape sheet the long edge is the horizontal one, so the reverse side
// keeps the same left/right orientation as the front.
//
// A printer set to flip on the SHORT EDGE mirrors the reverse side: contacts and the meeting
// order swap halves, and the programme opens with the meeting order on the left. If scenario 034
// reports that, the printer setting is the first thing to check, not this file.
//
// --------------------------------------------------------------------------------------------
// NO TEST CAN VERIFY THIS
// --------------------------------------------------------------------------------------------
// tests/lib/pdfRender.test.ts can prove that four panels exist and that each of the two pages
// holds two of them. It cannot prove that the fold comes out right — only folding paper can, which
// is why scenario 034 is a Definition-of-Done item for Milestone M4 rather than a nice-to-have.

export const PAGE_SIZE = "LETTER";
export const PAGE_ORIENTATION = "landscape";

export type ProgramDocumentProps = {
  draft: ProgramDraft;
  theme: PdfTheme;
  coverImage: string | null;
  qrDataUri: string | null;
  publicUrl: string | null;
};

export function ProgramDocument({
  draft,
  theme,
  coverImage,
  qrDataUri,
  publicUrl,
}: ProgramDocumentProps) {
  const sheet = { flexDirection: "row" as const, backgroundColor: "#ffffff" };

  return (
    <Document
      title={`Sacrament Meeting — ${theme.wardName} — ${draft.date}`}
      author={theme.wardName}
    >
      {/* FRONT of the sheet: the two OUTSIDE panels. */}
      <Page size={PAGE_SIZE} orientation={PAGE_ORIENTATION} style={sheet}>
        <BackPanel
          draft={draft}
          theme={theme}
          qrDataUri={qrDataUri}
          publicUrl={publicUrl}
        />
        <View style={{ width: 1, backgroundColor: "#e5e5e5" }} />
        <CoverPanel draft={draft} theme={theme} coverImage={coverImage} />
      </Page>

      {/* REVERSE of the sheet: the two INSIDE panels. */}
      <Page size={PAGE_SIZE} orientation={PAGE_ORIENTATION} style={sheet}>
        <ContactsPanel draft={draft} theme={theme} />
        <View style={{ width: 1, backgroundColor: "#e5e5e5" }} />
        <MeetingOrderPanel draft={draft} theme={theme} />
      </Page>
    </Document>
  );
}
