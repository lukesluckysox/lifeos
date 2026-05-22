import { createContext, useContext, useState, ReactNode, useCallback } from "react";

export type QuietDomain = "music" | "finance" | "film" | "watch" | "events" | "places" | "food" | "concerts";

interface QuietModeContextValue {
  /** Domains currently muted on the home dashboard. Other pages still render their own data. */
  muted: Set<QuietDomain>;
  isMuted: (d: QuietDomain) => boolean;
  toggle: (d: QuietDomain) => void;
  mute: (d: QuietDomain) => void;
  unmute: (d: QuietDomain) => void;
  /** Reset everything to audible. */
  reset: () => void;
}

const QuietModeContext = createContext<QuietModeContextValue | undefined>(undefined);

export function QuietModeProvider({ children }: { children: ReactNode }) {
  // Session-only — never persists. New tab = nothing muted.
  const [muted, setMuted] = useState<Set<QuietDomain>>(() => new Set());

  const isMuted = useCallback((d: QuietDomain) => muted.has(d), [muted]);

  const toggle = useCallback((d: QuietDomain) => {
    setMuted(prev => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }, []);

  const mute = useCallback((d: QuietDomain) => {
    setMuted(prev => {
      if (prev.has(d)) return prev;
      const next = new Set(prev);
      next.add(d);
      return next;
    });
  }, []);

  const unmute = useCallback((d: QuietDomain) => {
    setMuted(prev => {
      if (!prev.has(d)) return prev;
      const next = new Set(prev);
      next.delete(d);
      return next;
    });
  }, []);

  const reset = useCallback(() => setMuted(new Set()), []);

  return (
    <QuietModeContext.Provider value={{ muted, isMuted, toggle, mute, unmute, reset }}>
      {children}
    </QuietModeContext.Provider>
  );
}

export function useQuietMode() {
  const ctx = useContext(QuietModeContext);
  if (!ctx) throw new Error("useQuietMode must be used within QuietModeProvider");
  return ctx;
}

export const QUIET_DOMAIN_LABELS: Record<QuietDomain, string> = {
  music: "Music",
  finance: "Finance",
  film: "Film",
  watch: "Shows",
  events: "Events",
  places: "Places",
  food: "Food",
  concerts: "Concerts",
};
