/* eslint-disable jsx-a11y/alt-text --
 * Every <Image> in this file is @react-pdf/renderer's, not an HTML <img>. It renders into a PDF,
 * which has no accessibility tree for an alt attribute to attach to, and the component's props do
 * not include `alt` — passing one would be a type error. The rule matches on the element name and
 * cannot tell the two components apart.
 */
import { Image, Text, View } from "@react-pdf/renderer";
import { QR_MINIMUM_SIZE_POINTS } from "@/lib/pdf/qrCode";
import { FONT_SIZES, PANEL_PADDING, type PdfTheme } from "@/lib/pdf/theme";
import { textOf } from "@/lib/pdf/values";
import type { ProgramDraft } from "@/lib/program/draft";

// OUTSIDE LEFT. Missionaries, announcements, and the QR code that reaches the public page.
//
// Folded, this is the panel facing away from the reader — which is why it carries the things
// somebody looks up AFTER the meeting rather than during it.

// 60pt is about 21mm, just past the 20mm floor below which a folded, handled programme stops
// scanning reliably. Asserted rather than assumed: if somebody shrinks this to reclaim space, the
// build fails here instead of a congregation finding out in a chapel.
const QR_SIZE_POINTS = 60;

if (QR_SIZE_POINTS < QR_MINIMUM_SIZE_POINTS) {
  throw new Error(
    `The printed QR code is ${QR_SIZE_POINTS}pt, below the ${QR_MINIMUM_SIZE_POINTS}pt (20mm) ` +
      "minimum at which a folded programme still scans. See lib/pdf/qrCode.ts.",
  );
}

export type BackPanelProps = {
  draft: ProgramDraft;
  theme: PdfTheme;
  // null when the programme has no public page — the QR block then renders NOTHING rather than an
  // empty square or a code pointing at /public/null.
  qrDataUri: string | null;
  publicUrl: string | null;
};

function Section({
  heading,
  body,
  theme,
}: {
  heading: string;
  body: string | null;
  theme: PdfTheme;
}) {
  if (body === null) return null;

  return (
    <View style={{ marginBottom: 12 }}>
      <Text
        style={{
          fontFamily: theme.fontFamily,
          fontSize: FONT_SIZES.lineLabel,
          letterSpacing: 0.4,
          marginBottom: 3,
          color: theme.primaryColor,
        }}
      >
        {heading.toUpperCase()}
      </Text>
      <Text
        style={{ fontFamily: theme.fontFamily, fontSize: FONT_SIZES.body, lineHeight: 1.4 }}
      >
        {body}
      </Text>
    </View>
  );
}

export function BackPanel({ draft, theme, qrDataUri, publicUrl }: BackPanelProps) {
  return (
    <View style={{ flex: 1, padding: PANEL_PADDING, flexDirection: "column" }}>
      <Section
        heading="Full-time missionaries"
        body={textOf(draft.missionaries)}
        theme={theme}
      />
      <Section heading="Announcements" body={textOf(draft.announcements)} theme={theme} />

      {/* marginTop: "auto" pushes the QR to the foot of the panel whatever is above it, so the
          code sits in the same place on a sparse programme as on a full one. A reader learns
          where to point their phone once. */}
      {qrDataUri !== null && (
        <View style={{ marginTop: "auto", alignItems: "center" }}>
          <Image src={qrDataUri} style={{ width: QR_SIZE_POINTS, height: QR_SIZE_POINTS }} />
          <Text
            style={{
              fontFamily: theme.fontFamily,
              fontSize: FONT_SIZES.caption,
              marginTop: 4,
              textAlign: "center",
            }}
          >
            This programme online
          </Text>
          {/* The URL in words as well as in the code. A phone with no camera permission, a
              scanner that will not focus, and somebody typing it into a laptop are all real, and
              a QR with no printed fallback is a dead end for each of them. */}
          {publicUrl !== null && (
            <Text
              style={{
                fontFamily: theme.fontFamily,
                fontSize: FONT_SIZES.caption,
                textAlign: "center",
              }}
            >
              {publicUrl}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
