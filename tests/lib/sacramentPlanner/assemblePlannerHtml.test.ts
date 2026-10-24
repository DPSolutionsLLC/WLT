import { describe, expect, it } from "vitest";
import {
  BRIDGE_SCRIPT,
  assemblePlannerHtml,
} from "@/lib/sacramentPlanner/assemblePlannerHtml";

const HEAD = "<!doctype html><head><style>\n:root{}\n";
const CSS = ".x{color:red}";
const BODY = "<body><script>\nconst DATA = __DATA__;\nconst SECOND = '__DATA__';\n</script></body>";

describe("assemblePlannerHtml", () => {
  it("joins the parts the way build.py does, with the bridge before the Planner's script", () => {
    const html = assemblePlannerHtml({ head: HEAD, css: CSS, body: BODY, data: { ward: [] } });
    expect(html.startsWith(HEAD + CSS + "\n</style>\n\n" + BRIDGE_SCRIPT + "<body>")).toBe(true);
    expect(html.indexOf(BRIDGE_SCRIPT)).toBeLessThan(html.indexOf("const DATA"));
  });

  it("replaces only the first placeholder", () => {
    const html = assemblePlannerHtml({ head: HEAD, css: CSS, body: BODY, data: { ward: [] } });
    expect(html).toContain('const DATA = {"ward":[]};');
    expect(html).toContain("const SECOND = '__DATA__';");
  });

  it("escapes a name that would otherwise end the script early", () => {
    const html = assemblePlannerHtml({
      head: HEAD,
      css: CSS,
      body: BODY,
      data: { ward: [["Doe, </script><script>alert(1)", 30]] },
    });
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("<\\/script><script>alert(1)");
  });

  it("does not treat a $ in the data as a replacement pattern", () => {
    const html = assemblePlannerHtml({ head: HEAD, css: CSS, body: BODY, data: { note: "$&$'" } });
    expect(html).toContain('const DATA = {"note":"$&$\'"};');
  });

  it("throws when the placeholder is missing", () => {
    expect(() =>
      assemblePlannerHtml({ head: HEAD, css: CSS, body: "<body></body>", data: {} }),
    ).toThrow(/__DATA__/);
  });
});
