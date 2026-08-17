"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export type QueryProviderProps = { children: ReactNode };

// The client is built inside useState, NOT at module scope. A module-level QueryClient is
// created once per server process and shared by every request rendering this module, so one
// user's cached roster would be handed to the next user's render. useState(() => …) gives each
// browser its own client and never re-creates it across re-renders. This is the single most
// common mistake with this library and the reason the factory is a callback.
//
// staleTime 60s: opening a picker three times while planning a month is one request, and an
// edit made in another tab is stale for at most a minute. refetchOnWindowFocus off: a roster is
// not a live feed, and refetching every time a phone returns to the tab is noise on mobile.
export function QueryProvider({ children }: QueryProviderProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
