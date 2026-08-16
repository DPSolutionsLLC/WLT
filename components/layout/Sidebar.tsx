"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { NavigationItem } from "@/lib/auth/navigation";

export type SidebarProps = {
  navigationItems: NavigationItem[];
};

// The list arrives already filtered by the layout. This component never calls can() itself —
// one place decides what a role may see, and it is lib/auth/navigation.ts.
//
// One <aside> serves both breakpoints: an off-canvas drawer below md, a static column at md
// and up. Rendering the nav twice would duplicate the landmark and the links for anything
// reading the page non-visually.
export function Sidebar({ navigationItems }: SidebarProps) {
  const pathname = usePathname();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  function linkClasses(href: string): string {
    const isActive = pathname === href || pathname.startsWith(`${href}/`);

    return `flex min-h-11 items-center rounded-md px-3 py-2.5 text-sm ${
      isActive
        ? "bg-primary text-primary-foreground"
        : "text-foreground hover:bg-surface-raised"
    }`;
  }

  function isCurrent(href: string): "page" | undefined {
    return pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined;
  }

  // Dashboard is prepended here rather than living in NAVIGATION_ITEMS because it is the one
  // page every role may see, so it has no permission to filter on.
  const links: Array<{ label: string; href: string }> = [
    { label: "Dashboard", href: "/dashboard" },
    ...navigationItems.map((item) => ({ label: item.label, href: item.href })),
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setIsDrawerOpen(true)}
        aria-expanded={isDrawerOpen}
        aria-controls="sidebar"
        className="fixed bottom-4 left-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg md:hidden"
      >
        <span className="sr-only">Open navigation</span>
        <span aria-hidden="true" className="text-xl leading-none">
          ☰
        </span>
      </button>

      {isDrawerOpen && (
        <div
          role="presentation"
          onClick={() => setIsDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      )}

      <aside
        id="sidebar"
        className={`fixed inset-y-0 left-0 z-50 w-64 overflow-y-auto border-r border-border bg-surface transition-transform md:static md:z-auto md:w-60 md:shrink-0 md:translate-x-0 ${
          isDrawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-border p-3 md:hidden">
          <span className="text-sm font-semibold text-foreground">Navigation</span>
          <button
            type="button"
            onClick={() => setIsDrawerOpen(false)}
            className="min-h-11 min-w-11 rounded-md text-foreground"
          >
            <span className="sr-only">Close navigation</span>
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <nav aria-label="Main" className="flex flex-col gap-1 p-3">
          {links.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setIsDrawerOpen(false)}
              aria-current={isCurrent(item.href)}
              className={linkClasses(item.href)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
}
