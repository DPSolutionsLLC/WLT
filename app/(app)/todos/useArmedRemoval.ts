"use client";

import { useEffect, useState } from "react";

const ARM_TIMEOUT_MS = 4000;

// Which ✕ on a card is armed, if any — one at a time, so arming a step's ✕ disarms the card's.
// Clears itself after 4 seconds, with the timer cleaned up on unmount (ConfirmDeleteButton's
// reasoning, for a list of several buttons rather than one).
export function useArmedRemoval(): {
  armedKey: string | null;
  arm: (key: string) => void;
  disarm: () => void;
} {
  const [armedKey, setArmedKey] = useState<string | null>(null);

  useEffect(() => {
    if (armedKey === null) return;

    const timer = setTimeout(() => setArmedKey(null), ARM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [armedKey]);

  return { armedKey, arm: setArmedKey, disarm: () => setArmedKey(null) };
}
