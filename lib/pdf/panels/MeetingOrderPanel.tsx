import { Text, View } from "@react-pdf/renderer";
import { FONT_SIZES, PANEL_PADDING, type PdfTheme } from "@/lib/pdf/theme";
import { hymnOf, printedNameOf, textOf } from "@/lib/pdf/values";
import { speakerSlotLabel } from "@/lib/program/diff";
import type { ProgramDraft } from "@/lib/program/draft";

// INSIDE RIGHT. The order of the meeting, top to bottom, as it will actually be conducted.
//
// ---------------------------------------------------------------------------------------------
// THIS IS WHERE ITER-004 CLOSES
// ---------------------------------------------------------------------------------------------
// Every name here comes from printedNameOf(), which reads `printedName` and never `publicName`.
// An external speaker prints as "President Mark Andersen" — in full, with their title — because
// that string was typed by the bishopric specifically in order to be printed, and a visiting stake
// president has been named in full on every paper programme there has ever been.
//
// The public half of the same decision lives in lib/program/publicProjection.ts (program-c).
//
// ---------------------------------------------------------------------------------------------
// AN EMPTY LINE IS NOT PRINTED
// ---------------------------------------------------------------------------------------------
// See lib/pdf/values.ts. Nothing on this panel is ever the word "TBD" — and note that a
// placeholder could not get here even by mistake, because assembleDraft stores null rather than a
// placeholder string (program-a).

type LineProps = {
  label: string;
  value: string | null;
  theme: PdfTheme;
};

// Label above value rather than beside it. A 396pt panel minus padding is ~340pt wide; a
// label column would leave the long lines ("3 — Now Let Us Rejoice") wrapping in a 200pt gutter.
function Line({ label, value, theme }: LineProps) {
  if (value === null) return null;

  return (
    <View style={{ marginBottom: 7 }}>
      <Text
        style={{
          fontFamily: theme.fontFamily,
          fontSize: FONT_SIZES.lineLabel,
          letterSpacing: 0.4,
          color: theme.primaryColor,
        }}
      >
        {label.toUpperCase()}
      </Text>
      <Text style={{ fontFamily: theme.fontFamily, fontSize: FONT_SIZES.lineValue }}>
        {value}
      </Text>
    </View>
  );
}

function Paragraph({ label, value, theme }: LineProps) {
  if (value === null) return null;

  return (
    <View style={{ marginBottom: 7 }}>
      <Text
        style={{
          fontFamily: theme.fontFamily,
          fontSize: FONT_SIZES.lineLabel,
          letterSpacing: 0.4,
          color: theme.primaryColor,
        }}
      >
        {label.toUpperCase()}
      </Text>
      <Text
        style={{
          fontFamily: theme.fontFamily,
          fontSize: FONT_SIZES.body,
          lineHeight: 1.4,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

export type MeetingOrderPanelProps = {
  draft: ProgramDraft;
  theme: PdfTheme;
};

export function MeetingOrderPanel({ draft, theme }: MeetingOrderPanelProps) {
  const musical = draft.musicalNumber;
  const musicalLine =
    musical === null
      ? null
      : [textOf(musical.pieceTitle), printedNameOf(musical.performer)]
          .filter((part): part is string => part !== null)
          .join(" — ") || null;

  // Built as a list rather than rendered inline so an empty slot contributes nothing at all —
  // no <View>, no margin, no gap where a speaker was going to be.
  const speakers = draft.speakers
    .map((speaker) => ({
      slotNumber: speaker.slotNumber,
      name: textOf(speaker.printedName),
      topic: textOf(speaker.topic),
    }))
    .filter((speaker) => speaker.name !== null);

  return (
    <View style={{ flex: 1, padding: PANEL_PADDING, flexDirection: "column" }}>
      <Text
        style={{
          fontFamily: theme.fontFamily,
          fontSize: FONT_SIZES.panelHeading,
          marginBottom: 10,
          color: theme.primaryColor,
        }}
      >
        Order of Meeting
      </Text>

      <Line label="Presiding" value={printedNameOf(draft.presiding)} theme={theme} />
      <Line label="Conducting" value={printedNameOf(draft.conducting)} theme={theme} />
      <Line label="Organist" value={printedNameOf(draft.organist)} theme={theme} />
      <Line label="Chorister" value={printedNameOf(draft.chorister)} theme={theme} />
      <Line label="Opening hymn" value={hymnOf(draft.openingHymn)} theme={theme} />
      <Line label="Invocation" value={printedNameOf(draft.invocation)} theme={theme} />
      <Paragraph label="Ward business" value={textOf(draft.wardBusiness)} theme={theme} />
      <Line label="Sacrament hymn" value={hymnOf(draft.sacramentHymn)} theme={theme} />
      <Paragraph label="Notes" value={textOf(draft.specialNotes)} theme={theme} />
      <Line label="Musical number" value={musicalLine} theme={theme} />

      {speakers.map((speaker) => (
        <Line
          key={speaker.slotNumber}
          label={speakerSlotLabel(speaker.slotNumber)}
          value={
            speaker.topic === null ? speaker.name : `${speaker.name} — ${speaker.topic}`
          }
          theme={theme}
        />
      ))}

      <Line label="Closing hymn" value={hymnOf(draft.closingHymn)} theme={theme} />
      <Line label="Benediction" value={printedNameOf(draft.benediction)} theme={theme} />
    </View>
  );
}
