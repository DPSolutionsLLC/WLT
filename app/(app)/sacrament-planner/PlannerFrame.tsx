"use client";

import { useEffect, useRef } from "react";
import { createPlannerBridge } from "@/lib/sacramentPlanner/bridge";
import type { BishopricRoleLabel } from "@/lib/sacramentPlanner/identity";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export type PlannerFrameProps = {
  wardId: string;
  roleLabel: BishopricRoleLabel | null;
};

const FRAME_SOURCE = "/api/sacrament-planner/frame";

// The chrome bar is one row of 44px controls (min-h-11) with py-2 and a bottom border
// (components/layout/ChromeBar.tsx): 44 + 16 + 1. The frame takes the rest of the screen, and
// cancels <main>'s p-4 so the Planner's own banner and bottom tab bar sit edge to edge.
const CHROME_BAR_HEIGHT_PX = 61;

// The Planner follows the app's light or dark (decided walking scenario 093): its own theme button
// is hidden, and its CSS reads `data-theme` on its root, which is copied from the app's `dark`
// class on load and whenever the app's theme changes.
function syncTheme(frame: HTMLIFrameElement): void {
  const plannerRoot = frame.contentDocument?.documentElement;
  if (!plannerRoot) return;
  const appIsDark = document.documentElement.classList.contains("dark");
  plannerRoot.setAttribute("data-theme", appIsDark ? "dark" : "light");
}

// The frame is pointed at the Planner only AFTER the bridge is installed on this window, because
// the Planner's first script copies `window.parent.__wltPlannerBridge` the moment it runs.
//
// No `sandbox` attribute: the frame is same-origin and trusted, and the Planner's Call and Text
// buttons open the phone through `_top` navigation (tryOpenApp in assets/body.html).
export function PlannerFrame({ wardId, roleLabel }: PlannerFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const bridge = createPlannerBridge({
      wardId,
      roleLabel,
      supabase: createBrowserSupabaseClient(),
    });
    window.__wltPlannerBridge = bridge;

    const frame = frameRef.current;
    const onLoad = () => {
      if (frame) syncTheme(frame);
    };
    const themeObserver = new MutationObserver(onLoad);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    if (frame) {
      frame.addEventListener("load", onLoad);
      frame.src = FRAME_SOURCE;
    }

    return () => {
      themeObserver.disconnect();
      if (frame) {
        frame.removeEventListener("load", onLoad);
        frame.src = "about:blank";
      }
      bridge.dispose();
      if (window.__wltPlannerBridge === bridge) delete window.__wltPlannerBridge;
    };
  }, [wardId, roleLabel]);

  return (
    <div className="-m-4">
      <iframe
        ref={frameRef}
        title="Sacrament Planner"
        className="block w-full border-0"
        style={{ height: `calc(100dvh - ${CHROME_BAR_HEIGHT_PX}px)` }}
      />
    </div>
  );
}
