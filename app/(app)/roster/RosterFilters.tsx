"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  MEMBER_CATEGORIES,
  MEMBER_STATUSES,
  type MemberCategory,
  type MemberStatus,
  type RosterViewMode,
} from "@/types/domain";

export type RosterFiltersProps = {
  view: RosterViewMode;
  search: string;
  category: MemberCategory | "";
  status: MemberStatus | "";
};

const SELECT_CLASSES =
  "min-h-11 w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm " +
  "text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-primary";

const CATEGORY_LABELS: Record<MemberCategory, string> = {
  adult: "Adult",
  youth: "Youth",
  child: "Child",
};

const STATUS_LABELS: Record<MemberStatus, string> = {
  active: "Active",
  moved_out: "Moved Out",
  do_not_contact: "Do Not Contact",
};

// Pushes to the search params rather than holding the result set, so the page above stays a
// Server Component and a filtered roster is a link somebody can share or reload.
export function RosterFilters({ view, search, category, status }: RosterFiltersProps) {
  const router = useRouter();

  const [searchTerm, setSearchTerm] = useState(search);

  function apply(next: {
    search?: string;
    category?: string;
    status?: string;
  }): void {
    const params = new URLSearchParams();
    params.set("view", view);

    const nextSearch = next.search ?? searchTerm;
    const nextCategory = next.category ?? category;
    const nextStatus = next.status ?? status;

    if (nextSearch.trim() !== "") params.set("search", nextSearch.trim());
    if (nextCategory !== "") params.set("category", nextCategory);
    if (nextStatus !== "") params.set("status", nextStatus);

    router.push(`/roster?${params.toString()}`);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply({});
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 md:flex-row md:items-end"
      role="search"
    >
      <div className="md:flex-1">
        <Input
          id="roster-search"
          label="Search"
          type="search"
          placeholder="First name, last name, or family name"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="flex flex-col gap-1.5 md:w-44">
        <label htmlFor="roster-category" className="text-sm font-medium text-foreground">
          Category
        </label>
        <select
          id="roster-category"
          className={SELECT_CLASSES}
          value={category}
          onChange={(event) => apply({ category: event.target.value })}
        >
          <option value="">All categories</option>
          {MEMBER_CATEGORIES.map((option) => (
            <option key={option} value={option}>
              {CATEGORY_LABELS[option]}
            </option>
          ))}
        </select>
      </div>

      {/* No status selected shows active and do-not-contact members. Moved Out is always an
          explicit choice — it is the one that changes what the numbers on this page mean. */}
      <div className="flex flex-col gap-1.5 md:w-44">
        <label htmlFor="roster-status" className="text-sm font-medium text-foreground">
          Status
        </label>
        <select
          id="roster-status"
          className={SELECT_CLASSES}
          value={status}
          onChange={(event) => apply({ status: event.target.value })}
        >
          <option value="">In the ward</option>
          {MEMBER_STATUSES.map((option) => (
            <option key={option} value={option}>
              {STATUS_LABELS[option]}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" variant="secondary" className="md:min-w-24">
        Search
      </Button>
    </form>
  );
}
