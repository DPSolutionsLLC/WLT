import type { ReactNode } from "react";

// This route group must never call requireSessionUser(). Every page under it is reachable
// without a session by definition — guarding it would make signing in impossible.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-xl font-semibold text-foreground">
          Ward Leadership Tools
        </h1>
        {children}
      </div>
    </main>
  );
}
