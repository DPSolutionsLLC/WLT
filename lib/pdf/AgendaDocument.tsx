import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { AgendaSections } from "@/lib/agendas/sections";
import type { ActionItem } from "@/lib/agendas/carryForward";

// The meeting agenda PDF.
//
// ---------------------------------------------------------------------------------------------
// "SIMPLE, SINGLE-PAGE, NOTHING LIKE THE BIFOLD PROGRAM" — §Step A4, quoted because it is a
// design instruction and easy to drift from
// ---------------------------------------------------------------------------------------------
// The programme is a printed artefact handed to a congregation: it has panels, a cover image, a
// ward-configurable theme and four resolved layouts. An agenda is a working document that a
// bishopric reads off a phone or a single sheet on a table. It gets one column, one typeface and
// no configuration at all.
//
// NO THEME, deliberately, where ProgramDocument takes one. `wards.settings.program_template`
// configures how a ward's PRINTED PROGRAMME looks because a ward hands that to visitors. Nobody
// needs a house style on the bishopric's own agenda, and a second consumer of that setting would
// tie the two documents together for no reason anybody asked for.
//
// The base-14 fonts, for the reason lib/pdf/theme.ts states in full: no Font.register(), no font
// binaries in the repo, no licensing decision, and no network fetch at render time that could fail
// on a Vercel cold start.

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 56,
    fontFamily: "Helvetica",
    fontSize: 11,
    lineHeight: 1.5,
    color: "#111827",
  },
  wardName: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: "#6B7280",
  },
  title: {
    marginTop: 6,
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
  },
  meetingDate: {
    marginTop: 2,
    fontSize: 12,
    color: "#374151",
  },
  rule: {
    marginTop: 14,
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#D1D5DB",
  },
  section: { marginBottom: 18 },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
    color: "#111827",
  },
  item: { flexDirection: "row", marginBottom: 4, paddingRight: 8 },
  bullet: { width: 14, color: "#6B7280" },
  itemText: { flex: 1 },
  // An empty section prints its heading and this line rather than vanishing.
  //
  // A HEADING WITH NOTHING UNDER IT SAYS SOMETHING — "no items were flagged this fortnight" is a
  // fact a bishopric wants, and a section that disappeared would be indistinguishable from one
  // somebody forgot to fill in. It is the same reasoning that keeps a closed season's games listed
  // on the youth calendar rather than hidden.
  emptyNote: { color: "#9CA3AF", fontStyle: "italic" },
  actionRow: { flexDirection: "row", marginBottom: 5, paddingRight: 8 },
  actionBox: { width: 14, color: "#6B7280" },
  actionBody: { flex: 1 },
  actionMeta: { fontSize: 9, color: "#6B7280", marginTop: 1 },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 56,
    right: 56,
    fontSize: 8,
    color: "#9CA3AF",
    textAlign: "center",
  },
});

export type AgendaDocumentProps = {
  wardName: string;
  meetingTypeLabel: string;
  // Already formatted, with its zone named by the caller. c24d52b's rule: no formatter in this
  // repo may omit an explicit timeZone, and a PDF renderer running on a Vercel box in UTC is
  // exactly where "the server's zone" would silently be wrong.
  meetingDateLabel: string;
  sections: AgendaSections;
  actionItems: readonly ActionItem[];
  // The section the action items print under, matched by id. Null when a ward has deleted its
  // carry-forward section — the items then print in their own block at the end rather than being
  // dropped, because a PDF is the one place a person cannot go looking for them.
  actionSectionId: string | null;
  carriedLabels: Readonly<Record<string, string | null>>;
  footerNote: string;
};

function ActionItemRows({
  items,
  carriedLabels,
}: {
  items: readonly ActionItem[];
  carriedLabels: Readonly<Record<string, string | null>>;
}) {
  if (items.length === 0) {
    return <Text style={styles.emptyNote}>No open action items.</Text>;
  }

  return (
    <>
      {items.map((item) => {
        const carried = carriedLabels[item.id] ?? null;
        const meta = [
          item.assignedTo === null ? null : item.assignedTo,
          item.dueDate === null ? null : `due ${item.dueDate}`,
          carried,
        ].filter((part): part is string => part !== null);

        return (
          <View key={item.id} style={styles.actionRow} wrap={false}>
            {/* An empty box to tick, because this is a document somebody prints and writes on.
                A completed item prints a filled box rather than being omitted: what was closed at
                the last meeting is half of what a meeting produced. */}
            <Text style={styles.actionBox}>{item.status === "complete" ? "[x]" : "[ ]"}</Text>
            <View style={styles.actionBody}>
              <Text>{item.description}</Text>
              {meta.length > 0 ? <Text style={styles.actionMeta}>{meta.join(" · ")}</Text> : null}
            </View>
          </View>
        );
      })}
    </>
  );
}

export function AgendaDocument({
  wardName,
  meetingTypeLabel,
  meetingDateLabel,
  sections,
  actionItems,
  actionSectionId,
  carriedLabels,
  footerNote,
}: AgendaDocumentProps) {
  const orphanedActionItems = actionSectionId === null && actionItems.length > 0;

  return (
    <Document title={`${meetingTypeLabel} — ${meetingDateLabel}`}>
      {/* SINGLE PAGE IS THE INTENT, NOT A CONSTRAINT. `wrap` stays on so a ward with a long
          agenda gets a second page rather than a truncated one — a silently cut agenda is the
          worst possible failure for a document somebody is reading aloud from. */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.wardName}>{wardName}</Text>
        <Text style={styles.title}>{meetingTypeLabel}</Text>
        <Text style={styles.meetingDate}>{meetingDateLabel}</Text>
        <View style={styles.rule} />

        {sections.map((section) => (
          <View key={section.id} style={styles.section} wrap={false}>
            <Text style={styles.sectionTitle}>{section.title}</Text>

            {section.id === actionSectionId ? (
              <ActionItemRows items={actionItems} carriedLabels={carriedLabels} />
            ) : section.items.length === 0 ? (
              <Text style={styles.emptyNote}>Nothing recorded.</Text>
            ) : (
              section.items.map((item) => (
                <View key={item.id} style={styles.item}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={styles.itemText}>{item.text}</Text>
                </View>
              ))
            )}
          </View>
        ))}

        {orphanedActionItems ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Action items</Text>
            <ActionItemRows items={actionItems} carriedLabels={carriedLabels} />
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          {footerNote}
        </Text>
      </Page>
    </Document>
  );
}
