import { describe, expect, it } from "vitest";
import {
  ALWAYS_ON_PERMISSION_PREFIXES,
  RELEASED_MODULES,
  assertPermissionsArePlaced,
  isModuleReleased,
  moduleForPath,
  moduleOfPermission,
  unreleasedBuiltModules,
} from "@/lib/access/releasedModules";
import { PERMISSIONS } from "@/lib/auth/permissions";

// THE RELEASED-MODULES CATALOG (ITER-041). Pure — no database. The policies that mirror `tables`
// are compared in tests/db/module-release-policies.test.ts, and the pages that mirror
// `routePrefixes` in tests/lib/releasedRoutesCovered.test.ts.

describe("moduleOfPermission", () => {
  it("places every permission in exactly one module, or always-on", () => {
    for (const permission of PERMISSIONS) {
      const owners = RELEASED_MODULES.filter((module) =>
        (module.permissionPrefixes as readonly string[]).some((prefix) =>
          permission.startsWith(prefix),
        ),
      ).length;
      const alwaysOn = ALWAYS_ON_PERMISSION_PREFIXES.some((prefix) =>
        permission.startsWith(prefix),
      )
        ? 1
        : 0;
      expect({ permission, places: owners + alwaysOn }).toEqual({ permission, places: 1 });
    }
  });

  it("names the owning module, with named anchors", () => {
    expect(moduleOfPermission("agendas.view")).toBe("agendas");
    expect(moduleOfPermission("talks.plan")).toBe("sacrament");
    expect(moduleOfPermission("goals.view")).toBe("visits");
    expect(moduleOfPermission("audit.view")).toBe("admin");
    // `sacrament.` and `sacrament_ordinances` — the dot is what keeps them apart.
    expect(moduleOfPermission("sacrament.mark_sent")).toBe("sacrament_ordinances");
  });

  it("answers null for an always-on permission", () => {
    expect(moduleOfPermission("notifications.view")).toBeNull();
  });

  it("throws on a permission no module claims", () => {
    expect(() => moduleOfPermission("speakers.view")).toThrow(/belongs to no released module/);
  });

  // The import-time check is what makes adding a permission without placing it fail every page.
  it("refuses a permission list containing one nothing claims", () => {
    expect(() => assertPermissionsArePlaced([...PERMISSIONS, "unplaced.view"])).toThrow(
      /must belong to exactly one released module/,
    );
    expect(() => assertPermissionsArePlaced(PERMISSIONS)).not.toThrow();
  });
});

describe("moduleForPath", () => {
  it("matches whole segments only", () => {
    expect(moduleForPath("/talks")).toBe("sacrament");
    expect(moduleForPath("/talks/topics")).toBe("sacrament");
    expect(moduleForPath("/talkative")).toBeNull();
  });

  it("prefers the longest matching prefix", () => {
    expect(moduleForPath("/sacrament")).toBe("sacrament");
    expect(moduleForPath("/sacrament/2026-10-18")).toBe("sacrament");
    expect(moduleForPath("/sacrament/ordinances")).toBe("sacrament_ordinances");
  });

  it("leaves the dashboard as core", () => {
    expect(moduleForPath("/dashboard")).toBeNull();
  });

  it("maps the admin section, Stakes & Wards included", () => {
    expect(moduleForPath("/admin")).toBe("admin");
    expect(moduleForPath("/admin/stakes")).toBe("admin");
  });
});

describe("isModuleReleased", () => {
  it("releases everything when the ward has no list", () => {
    expect(isModuleReleased({ isSuperAdmin: false, releasedModules: null }, "roster")).toBe(true);
  });

  it("releases everything for a super admin, whatever the list", () => {
    expect(isModuleReleased({ isSuperAdmin: true, releasedModules: [] }, "roster")).toBe(true);
  });

  it("releases a listed module and withholds an unlisted one", () => {
    const user = { isSuperAdmin: false, releasedModules: ["tithing"] as const };
    expect(isModuleReleased(user, "tithing")).toBe(true);
    expect(isModuleReleased(user, "roster")).toBe(false);
  });
});

describe("unreleasedBuiltModules", () => {
  it("is empty when the ward has no list", () => {
    expect(unreleasedBuiltModules(null)).toEqual([]);
  });

  it("names built modules only — an unbuilt one left off is not news", () => {
    const withheld = unreleasedBuiltModules(["tithing"]);
    expect(withheld).toContain("roster");
    expect(withheld).not.toContain("speakers");
    expect(withheld).not.toContain("tithing");
  });
});
