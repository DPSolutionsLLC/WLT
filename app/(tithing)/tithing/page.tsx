import { TithingCounter } from "@/app/(tithing)/tithing/TithingCounter";

// Nothing to fetch and nothing to pass. This is the one module in the app that reads no data and
// writes none: a counting session lives entirely in the browser for as long as the tab is open
// (TithingCounter.tsx says why, and what it costs).
//
// The access check is in the layout above, so this file has no guard of its own.
export default function TithingPage() {
  return <TithingCounter />;
}
