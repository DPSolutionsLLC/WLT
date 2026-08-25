/* eslint-disable jsx-a11y/alt-text --
 * Every <Image> in this file is @react-pdf/renderer's, not an HTML <img>. It renders into a PDF,
 * which has no accessibility tree for an alt attribute to attach to, and the component's props do
 * not include `alt` — passing one would be a type error. The rule matches on the element name and
 * cannot tell the two components apart.
 */
import { Image, Text, View } from "@react-pdf/renderer";
import { FONT_SIZES, PANEL_PADDING, type PdfTheme } from "@/lib/pdf/theme";
import { textOf } from "@/lib/pdf/values";
import { formatSundayLabelWithYear } from "@/lib/calendar/dates";
import type { ProgramDraft } from "@/lib/program/draft";

// OUTSIDE RIGHT. The half of the sheet somebody is looking at before they open it.
//
// A LIMITED CSS SUBSET. @react-pdf/renderer supports flexbox and a subset of properties — no CSS
// grid, no `gap` shorthand worth relying on, no percentage line-heights. Everything here is
// flex-direction, margins and explicit sizes, built to those limits rather than ported from the
// web preview (06-program-music.md).

export type CoverPanelProps = {
  draft: ProgramDraft;
  theme: PdfTheme;
  // Already a data URI or an absolute URL by the time it reaches here. renderProgram.ts fetches a
  // Supabase Storage cover into a buffer first — @react-pdf/renderer resolving a URL itself is a
  // network call inside the render, which is the cold-start failure Task 5 warns about.
  coverImage: string | null;
};

export function CoverPanel({ draft, theme, coverImage }: CoverPanelProps) {
  const heading = textOf(draft.heading);

  return (
    <View
      style={{
        flex: 1,
        padding: PANEL_PADDING,
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontFamily: theme.fontFamily,
          fontSize: FONT_SIZES.churchName,
          textAlign: "center",
          letterSpacing: 0.5,
          color: theme.primaryColor,
        }}
      >
        {theme.churchName.toUpperCase()}
      </Text>

      {/* null on an ordinary Sunday, and then NOTHING renders — not an empty element with its
          margin still taking up space. program-a Decision 1: this is the ward conference case. */}
      {heading !== null && (
        <Text
          style={{
            fontFamily: theme.fontFamily,
            fontSize: FONT_SIZES.coverHeading,
            marginTop: 18,
            textAlign: "center",
            color: theme.primaryColor,
          }}
        >
          {heading}
        </Text>
      )}

      {coverImage !== null && (
        <Image
          src={coverImage}
          style={{ marginTop: 18, width: 150, height: 150, objectFit: "contain" }}
        />
      )}

      <Text
        style={{
          fontFamily: theme.fontFamily,
          fontSize: FONT_SIZES.coverWardName,
          marginTop: 18,
          textAlign: "center",
          color: theme.primaryColor,
        }}
      >
        {theme.wardName}
      </Text>

      <Text
        style={{
          fontFamily: theme.fontFamily,
          fontSize: FONT_SIZES.panelHeading,
          marginTop: 6,
          textAlign: "center",
        }}
      >
        Sacrament Meeting
      </Text>

      <Text
        style={{
          fontFamily: theme.fontFamily,
          fontSize: FONT_SIZES.coverDate,
          marginTop: 10,
          textAlign: "center",
        }}
      >
        {formatSundayLabelWithYear(draft.date)}
      </Text>
    </View>
  );
}
