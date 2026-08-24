import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiSettingsForm } from "@/app/(app)/ai-settings/AiSettingsForm";
import type { AiSettings } from "@/types/domain";

// THE STALE-FORM ASSERTION.
//
// Restoring a version appends a row and makes it active, and the Server Component re-reads it.
// But `router.refresh()` PRESERVES client state by design, so a `useState` initialiser never runs
// a second time — the history updated, the form kept the values it mounted with, and a restore
// looked like it had done nothing.
//
// Re-rendering with new props is exactly what router.refresh() produces, so that is what this
// drives. Without the reset-during-render in AiSettingsForm, the first assertion below fails
// while every route and RLS test still passes: nothing server-side was ever wrong.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function settings(id: string, toneVoice: string): AiSettings {
  return {
    id,
    toneVoice,
    doctrinalEmphasis: null,
    scripturePreferences: {
      canonPriority: ["book_of_mormon"],
      maxReferences: 3,
      relevanceNotes: null,
    },
    conferencePreferences: { maxYearsOld: null, maxTalks: 3, preferKnowledgeBase: true },
    topicPreferences: null,
    wardContext: null,
    thankYouPreferences: null,
    savedBy: "user-1",
    createdAt: "2026-08-12T18:45:00.000Z",
  };
}

function toneField(): HTMLTextAreaElement {
  return screen.getByLabelText(/Tone & voice/i) as HTMLTextAreaElement;
}

describe("AiSettingsForm", () => {
  it("follows the active version when a restore changes it underneath", () => {
    const { rerender } = render(
      <AiSettingsForm initialSettings={settings("v2", "Formal and complete.")} canManage />,
    );

    expect(toneField().value).toBe("Formal and complete.");

    // What a restore produces: a NEW row id carrying the older version's content.
    rerender(
      <AiSettingsForm initialSettings={settings("v3", "Warm and brief.")} canManage />,
    );

    expect(toneField().value).toBe("Warm and brief.");
  });

  it("loads null settings as an empty form rather than the word null", () => {
    render(<AiSettingsForm initialSettings={null} canManage />);

    expect(toneField().value).toBe("");
    // A ward with no saved settings must not see a recency limit of 0 — blank means no limit.
    const years = screen.getByLabelText(/Only talks from the last/i) as HTMLInputElement;
    expect(years.value).toBe("");
  });

  it("gives every field on the page a distinct id", () => {
    const { container } = render(
      <AiSettingsForm initialSettings={settings("v1", "Tone.")} canManage />,
    );

    // Seven sections on one page. A repeated id makes a label point at the wrong input
    // (plans/retros/talks-c-prayers-topics.md).
    const ids = [...container.querySelectorAll("[id]")].map((element) => element.id);

    expect(ids.length).toBeGreaterThan(8);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Not a DISABLED save button — a disabled control reads as "this is coming"
  // (plans/retros/talks-b-month-planner.md), and this is a permanent answer for this role.
  it("renders no save button and no preview panel for a role that cannot manage", () => {
    render(
      <AiSettingsForm initialSettings={settings("v1", "Tone.")} canManage={false} />,
    );

    expect(screen.queryByRole("button", { name: /Save as a new version/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Preview$/i })).toBeNull();
    expect(toneField().disabled).toBe(true);
  });
});
