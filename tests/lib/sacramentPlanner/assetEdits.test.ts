// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SLOT_RULES_END, SLOT_RULES_START } from "@/tests/helpers/plannerSlotRules";

// THE PLANNER'S OWN CODE IS IMPORTED, AND EDITED ONLY FOR LISTED REASONS (ITER-045, plan Task 2).
// No component test can render it, so this reads the file the way explicitTimeZone.test.ts reads
// source, and pins each edit so a later copy of a fresh handoff cannot silently drop one.

const BODY = readFileSync(
  path.join(process.cwd(), "lib", "sacramentPlanner", "assets", "body.html"),
  "utf8",
);

const EXTRA_CSS = readFileSync(
  path.join(process.cwd(), "lib", "sacramentPlanner", "assets", "extra.css"),
  "utf8",
);

function functionBody(name: string): string {
  const start = BODY.indexOf(`function ${name}(`);
  expect(start, `${name}() is missing from body.html`).toBeGreaterThan(-1);
  return BODY.slice(start, BODY.indexOf("\n}", start));
}

describe("the Sacrament Planner's edited assets", () => {
  it("keeps placeholders, not names, in the bishopric and contacts defaults (E1)", () => {
    expect(BODY).toContain(
      'const DEFAULT_BISHOPRIC = [{name:"Bishop",role:"Bishop"},{name:"1st Counselor",role:"1st Counselor"},{name:"2nd Counselor",role:"2nd Counselor"}];',
    );
    expect(BODY).toMatch(/const DEFAULT_CONTACTS = \{musicCoordinator:"", execSecretary:"",/);
  });

  // Found walking scenario 093: the first render checks `me` against the PLACEHOLDER bishopric,
  // because the settings documents have not loaded yet, and cleared the signed-in name.
  it("lets the login decide who you are on every render, outside practice (E2)", () => {
    const renderActing = functionBody("renderActing");
    const loginLine = renderActing.indexOf("if (state.loginMe && !isTest()) state.me = state.loginMe;");
    const clearingLine = renderActing.indexOf("!members.some(m => m.name === state.me)) state.me = \"\"");
    expect(loginLine).toBeGreaterThan(-1);
    expect(loginLine).toBeLessThan(clearingLine);
  });

  it("hides the 'You are' menu and offers Practice mode in the header and the More sheet (E2)", () => {
    expect(BODY).toContain('<label class="acting" hidden>You are <select id="actingAs"></select></label>');
    expect(BODY).toContain('id="practiceMode"');
    expect(BODY).toContain('id="practiceMode2"');
    expect(BODY).not.toContain('<select id="actingAs2"');
  });

  it("prefixes every one of its storage keys with planner: (E3)", () => {
    const keys = [...BODY.matchAll(/localStorage\.\w+\("([^"]*)"/g)].map((match) => match[1]);
    expect(keys.length).toBe(14);
    expect(keys.filter((key) => !key.startsWith("planner:"))).toEqual([]);
  });

  // GROUP-04 (plans/sacrament-planner-refinements.md), edits G1–G5.
  it("remembers the folded panel and the Calls past view per device under planner: keys (D1)", () => {
    expect(BODY).toContain('localStorage.getItem("planner:bulkFold")');
    expect(BODY).toContain('localStorage.setItem("planner:bulkFold"');
    expect(BODY).toContain('localStorage.getItem("planner:callsPast")');
    expect(BODY).toContain('localStorage.setItem("planner:callsPast"');
  });

  it("reserves room for the selection panel on a phone (G1)", () => {
    expect(BODY).toContain('style.setProperty("--bulkh"');
    expect(EXTRA_CSS).toContain("var(--bulkh, 0px)");
  });

  it("places every ticked person with one write (G2)", () => {
    expect(BODY).toContain('id="bulkPlace"');
    expect(functionBody("placeMany")).toContain("placeIntoSlots(");
  });

  it("starts a Fast & Testimony Sunday with no empty speaker slots (G3)", () => {
    expect(functionBody("blankSunday0")).toContain("withoutEmptySpeakers(");
  });

  it("uses one placement rule for Pray About and Who's Next, warning when full (G4)", () => {
    expect(functionBody("placeConsider")).toContain("placeIntoSlots(");
    expect(functionBody("placeMany")).toContain('"warn"');
  });

  it("refuses call actions on a Sunday that has locked (G5)", () => {
    expect(BODY).toContain("const callLocked = date => !callEditable(");
    expect(functionBody("refuseLocked")).toContain("callLocked(");
    const handlers = ["callacc", "calldec", "callmsg", "callundo", "swapopen", "swapto", "slotremove", "slotdrop", "declsave"];
    for (const handler of handlers) expect(BODY).toContain(`if (d.${handler}) { `);
    expect([...BODY.matchAll(/if \(refuseLocked\(d\.(\w+), t\)\) return;/g)].map((match) => match[1]).sort()).toEqual(
      [...handlers].sort(),
    );
  });

  it("keeps the slot-rules markers exactly once each", () => {
    expect(BODY.split(SLOT_RULES_START).length - 1).toBe(1);
    expect(BODY.split(SLOT_RULES_END).length - 1).toBe(1);
  });

  // Decided reviewing scenario 093: the app's theme decides, set on this page by PlannerFrame.tsx.
  it("has no theme control of its own and ignores a stored theme", () => {
    expect(BODY).toContain('id="themeBtn" type="button" hidden>');
    expect(BODY).toContain('applyTheme("auto");');
    expect(BODY).not.toContain('localStorage.getItem("planner:theme")');
  });

  it("still carries the placeholder the frame route fills", () => {
    expect(BODY).toContain("const DATA = __DATA__;");
  });
});
