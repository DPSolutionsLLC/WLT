"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import type { ThemePreference } from "@/types/domain";

export type ThemeToggleProps = {
  initialPreference: ThemePreference;
};

const NEXT_PREFERENCE: Record<ThemePreference, ThemePreference> = {
  light: "dark",
  dark: "system",
  system: "light",
};

const LABELS: Record<ThemePreference, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

function applyPreference(preference: ThemePreference): void {
  const isDark =
    preference === "dark" ||
    (preference === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  document.documentElement.classList.toggle("dark", isDark);

  // Same key the pre-paint script in app/layout.tsx reads. If these two ever disagree, the
  // page flashes the wrong theme on every load.
  try {
    window.localStorage.setItem("theme", preference);
  } catch (error) {
    console.error("Could not persist the theme to localStorage", error);
  }
}

export function ThemeToggle({ initialPreference }: ThemeToggleProps) {
  const [preference, setPreference] = useState<ThemePreference>(initialPreference);

  async function handleClick() {
    const next = NEXT_PREFERENCE[preference];

    // Local first, always. The visible change must not wait on a network round trip, and a
    // failed save must not undo what the user just asked for.
    setPreference(next);
    applyPreference(next);

    const supabase = createBrowserSupabaseClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error("Could not identify the user to save the theme preference", authError);
      return;
    }

    const { error } = await supabase
      .from("users")
      .update({ theme_preference: next })
      .eq("id", user.id);

    if (error) {
      console.error("Could not save the theme preference", { error: error.message });
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="min-h-11 rounded-md border border-border px-3 text-sm text-foreground hover:bg-surface-raised"
    >
      <span className="sr-only">Change theme. Currently {LABELS[preference]}.</span>
      <span aria-hidden="true">{LABELS[preference]}</span>
    </button>
  );
}
