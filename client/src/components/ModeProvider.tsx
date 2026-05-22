import { createContext, useContext, useState, ReactNode } from "react";

type Mode = "live" | "demo";

interface ModeContextValue {
  mode: Mode;
  setMode: (m: Mode) => void;
  toggle: () => void;
  /** Append ?mode=demo (or &mode=demo) to a URL when in demo mode. No-op for live. */
  withMode: (url: string) => string;
}

const ModeContext = createContext<ModeContextValue | undefined>(undefined);

export function ModeProvider({ children }: { children: ReactNode }) {
  // Session-only \u2014 always starts "live" on every page load.
  const [mode, setMode] = useState<Mode>("live");
  const toggle = () => setMode(m => (m === "live" ? "demo" : "live"));
  const withMode = (url: string) => {
    if (mode === "live") return url;
    return url + (url.includes("?") ? "&" : "?") + "mode=demo";
  };
  return (
    <ModeContext.Provider value={{ mode, setMode, toggle, withMode }}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode() {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error("useMode must be used within ModeProvider");
  return ctx;
}
