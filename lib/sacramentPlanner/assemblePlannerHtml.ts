// Reproduces the Planner's own build.py, at request time rather than at build time, so the member
// list and agenda history come from the database for the signed-in ward and never sit in a file:
//
//   head + css + "\n</style>\n\n" + body, with the FIRST __DATA__ replaced by the data, and every
//   "</" escaped so a name containing "</script>" cannot end the script early.
//
// The one addition is BRIDGE_SCRIPT, placed before the Planner's own script so `window.claude` is
// already set when its `if (!window.claude) …` line runs. The page that frames the Planner
// (app/(app)/sacrament-planner/PlannerFrame.tsx) installs the bridge on itself before it renders
// the frame, and the frame is same-origin, so it can reach it.

export const DATA_PLACEHOLDER = "__DATA__";

export const BRIDGE_SCRIPT =
  "<script>window.claude = (window.parent !== window && window.parent.__wltPlannerBridge) || undefined;</script>\n";

export type PlannerPageParts = {
  head: string;
  css: string;
  body: string;
  data: unknown;
};

export function assemblePlannerHtml({ head, css, body, data }: PlannerPageParts): string {
  if (!body.includes(DATA_PLACEHOLDER)) {
    throw new Error(
      `The Sacrament Planner's body.html has no ${DATA_PLACEHOLDER} placeholder, so its data cannot be placed.`,
    );
  }

  const serialized = JSON.stringify(data).replaceAll("</", "<\\/");
  const page = head + css + "\n</style>\n\n" + BRIDGE_SCRIPT + body;
  return page.replace(DATA_PLACEHOLDER, () => serialized);
}
