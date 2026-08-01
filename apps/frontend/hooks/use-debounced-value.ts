"use client";

import { useEffect, useState } from "react";

/**
 * Delays a fast-changing value (a search box) so dependent queries fire once
 * the user pauses instead of on every keystroke.
 *
 * Typing "Mohamed" previously issued seven requests, each re-rendering the list
 * and racing the others to settle.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
