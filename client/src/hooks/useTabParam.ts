import { useState, useEffect, useCallback } from "react";

/**
 * Reads a `?tab=...` value from the hash-routing URL. Because we use
 * hash routing (`#/watch?tab=film`), the query string lives inside the
 * hash, not on `window.location.search`. This parses it manually and
 * stays in sync with hashchange events.
 *
 * No localStorage, no cookies — purely derived from the URL.
 */
export function useTabParam<T extends string>(defaultTab: T): [T, (next: T) => void] {
  const read = useCallback((): T => {
    if (typeof window === "undefined") return defaultTab;
    const hash = window.location.hash || "";
    // hash looks like "#/watch?tab=film&foo=bar" — split off query
    const qIdx = hash.indexOf("?");
    if (qIdx === -1) return defaultTab;
    const params = new URLSearchParams(hash.slice(qIdx + 1));
    const v = params.get("tab");
    return (v as T) || defaultTab;
  }, [defaultTab]);

  const [tab, setTab] = useState<T>(read);

  useEffect(() => {
    const handler = () => setTab(read());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, [read]);

  const set = useCallback(
    (next: T) => {
      if (typeof window === "undefined") return;
      const hash = window.location.hash || "#/";
      const qIdx = hash.indexOf("?");
      const path = qIdx === -1 ? hash : hash.slice(0, qIdx);
      const params = new URLSearchParams(qIdx === -1 ? "" : hash.slice(qIdx + 1));
      params.set("tab", next);
      // Replace state so back button isn't polluted by tab swaps
      const newHash = `${path}?${params.toString()}`;
      if (newHash !== hash) {
        window.history.replaceState(null, "", newHash);
        setTab(next);
      } else {
        setTab(next);
      }
    },
    [],
  );

  return [tab, set];
}
