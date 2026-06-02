import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Accent = "blue" | "teal" | "gold" | "violet" | "rose";

interface Ctx {
  accent: Accent;
  setAccent: (a: Accent) => void;
}

const AccentCtx = createContext<Ctx | null>(null);

// Each accent swaps --primary, --accent-blue (used as the default interactive color),
// --ring, and sidebar-primary so the whole UI shifts consistently.
const ACCENT_VARS: Record<Accent, Record<string, string>> = {
  blue: {
    "--primary":         "212 72% 58%",
    "--accent-blue":     "212 72% 62%",
    "--ring":            "212 72% 58%",
    "--sidebar-primary": "212 72% 58%",
  },
  teal: {
    "--primary":         "174 44% 48%",
    "--accent-blue":     "174 44% 52%",
    "--ring":            "174 44% 48%",
    "--sidebar-primary": "174 44% 48%",
  },
  gold: {
    "--primary":         "38 62% 52%",
    "--accent-blue":     "38 62% 56%",
    "--ring":            "38 62% 52%",
    "--sidebar-primary": "38 62% 52%",
  },
  violet: {
    "--primary":         "258 52% 60%",
    "--accent-blue":     "258 52% 64%",
    "--ring":            "258 52% 60%",
    "--sidebar-primary": "258 52% 60%",
  },
  rose: {
    "--primary":         "348 52% 58%",
    "--accent-blue":     "348 52% 62%",
    "--ring":            "348 52% 58%",
    "--sidebar-primary": "348 52% 58%",
  },
};

function applyAccent(accent: Accent) {
  const root = document.documentElement;
  const vars = ACCENT_VARS[accent];
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
}

export function AccentProvider({ children }: { children: ReactNode }) {
  const [accent, setAccentState] = useState<Accent>(() => {
    if (typeof window === "undefined") return "blue";
    return (localStorage.getItem("radius-accent") as Accent) ?? "blue";
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
