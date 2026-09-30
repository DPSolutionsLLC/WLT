// A sentence naming the consequence, not the mechanism. Every edit to a talk clears its approvals
// (PATCH /api/assignments/[id]), so every surface that edits one says so BEFORE the write, naming
// who loses their approval when it knows. roster-c shipped a confirm button whose explanation was
// never announced with it; calendar-b's rule is that the button is aria-describedby this text.
//
// Pure and client-safe: the month planner's modal and the Topics screen's windows both use it.
// `action` names what the button beside the sentence does: the planning window SAVES, a talk row's
// Clear CLEARS (walking scenario 083 found "Saving" printed beside a Clear button).
export function describeInvalidation(
  approvedCount: number,
  approvedNames?: readonly string[],
  action: "save" | "clear" = "save",
): string {
  const who =
    approvedNames && approvedNames.length > 0
      ? approvedNames.length === 1
        ? `${approvedNames[0]} has approved this plan.`
        : `${approvedNames.slice(0, -1).join(", ")} and ${approvedNames[approvedNames.length - 1]} have approved this plan.`
      : `${approvedCount} ${approvedCount === 1 ? "member has" : "members have"} approved this plan.`;

  return action === "clear"
    ? `${who} Clearing this resets their approvals and asks them again.`
    : `${who} Saving clears those approvals and asks them again.`;
}
