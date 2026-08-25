import { Text, View } from "@react-pdf/renderer";
import { FONT_SIZES, PANEL_PADDING, type PdfTheme } from "@/lib/pdf/theme";
import { textOf } from "@/lib/pdf/values";
import type { ProgramDraft } from "@/lib/program/draft";

// INSIDE LEFT. Who to ring, and how.
//
// ---------------------------------------------------------------------------------------------
// THIS PANEL IS THE REASON THE PUBLIC PAGE OMITS AN ENTIRE ARRAY
// ---------------------------------------------------------------------------------------------
// `leadershipContacts` carries PHONE NUMBERS. program-c's toPublicProgram() does not redact inside
// the array — it leaves `leadershipContacts` off the PublicProgram type altogether, so publishing
// one is a type error rather than a review miss (CLAUDE.md §9).
//
// ALWAYS PRINTED, NEVER PUBLIC. That asymmetry is the whole point: a paper programme handed round
// a chapel is exactly where a ward's contact list belongs, and /public/[slug] is exactly where it
// does not.

export type ContactsPanelProps = {
  draft: ProgramDraft;
  theme: PdfTheme;
};

export function ContactsPanel({ draft, theme }: ContactsPanelProps) {
  const contacts = draft.leadershipContacts
    .map((contact) => ({
      role: textOf(contact.role),
      name: textOf(contact.name),
      phone: textOf(contact.phone),
    }))
    .filter((contact) => contact.name !== null);

  // A ward that has not filled in Phase 11's admin screen yet has no contacts, and this panel
  // renders as an empty half-sheet rather than as a heading standing over nothing. The fold and
  // the margins still have to be right on a blank panel, which is why the padded View stays.
  if (contacts.length === 0) {
    return <View style={{ flex: 1, padding: PANEL_PADDING }} />;
  }

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
        Ward Leadership
      </Text>

      {contacts.map((contact, index) => (
        <View key={`${contact.role ?? "contact"}-${index}`} style={{ marginBottom: 8 }}>
          {contact.role !== null && (
            <Text
              style={{
                fontFamily: theme.fontFamily,
                fontSize: FONT_SIZES.lineLabel,
                letterSpacing: 0.4,
                color: theme.primaryColor,
              }}
            >
              {contact.role.toUpperCase()}
            </Text>
          )}
          <Text style={{ fontFamily: theme.fontFamily, fontSize: FONT_SIZES.lineValue }}>
            {contact.name}
          </Text>
          {contact.phone !== null && (
            <Text style={{ fontFamily: theme.fontFamily, fontSize: FONT_SIZES.body }}>
              {contact.phone}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}
