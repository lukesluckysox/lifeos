import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Accent = "teal" | "gold" | "violet" | "rose" | "slate";

interface Ctx {
  accent: Accent;
  setAccent: (a: Accent) => void;
}

const AccentCtx = createContext<Ctx | null>(null);

// Each accent swaps --primary, --accent-teal (the brand color used everywhere),
// --ring, and the sidebar primary so the whole UI shifts consistently.
const ACCENT_VARS: Record<Accent, Record<string, string>> = {
  teal: {
    "--primary":         "184 38% 52%",
    "--accent-teal":     "184 42% 56%",
    "--ring":            "184 42% 52%",
    "--sidebar-primary": "184 42% 52%",
  },
  gold: {
    "--primary":         "38 58% 52%",
    "--accent-teal":     "38 62% 56%",
    "--ring":            "38 62% 52%",
    "--sidebar-primary": "38 62% 52%",
  },
  violet: {
    "--primary":         "258 52% 60%",
    "--accent-teal":     "258 52% 64%",
    "--ring":            "258 52% 60%",
    "--sidebar-primary": "258 52% 60%",
  },
  rose: {
    "--primary":         "350 46% 58%",
    "--accent-teal":     "350 46% 62%",
    "--ring":            "350 46% 58%",
    "--sidebar-primary": "350 46% 58%",
  },
  slate: {
    "--primary":         "220 14% 60%",
    "--accent-teal":     "220 14% 64%",
    "--ring":            "220 14% 60%",
    "--sidebar-primary": "220 14% 60%",
  },
};

function applyAccent(accent: Accent) {
  const root = document.documentElement;
  const vars = ACCENT_VARS[accent];
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
}

export function AccentProvider({ children }: { children: ReactNode }) {
  const [accent, setAccentState] = useState<Accent>(() => {
    if (typeof window === "undefined") return "teal";
    return (localStorage.getItem("radius-accent") as Accent) ?? "teal";
  });

  const setAccent = (a: Accent) => {
    localStorage.setItem("radius-accent", a);
    setAccentState(a);
    applyAccent(a);
  };

  useEffect(() => { applyAccent(accent); }, [accent]);

  return (
    <AccentCtx.Provider value={{ accent, setAccent }}>
      {children}
    </AccentCtx.Provider>
  );
}

export const useAccent = () => {
  const c = useContext(AccentCtx);
  if (!c) throw new Error("useAccent outside AccentProvider");
  return c;
};
