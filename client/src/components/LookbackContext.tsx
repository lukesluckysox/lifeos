import { createContext, useContext, useState, type ReactNode } from "react";

export type LookbackOption = { label: string; weeks: number; testId: string };

export const LOOKBACK_OPTIONS: LookbackOption[] = [
  { label: "1W", weeks: 1, testId: "lookback-1w" },
  { label: "1M", weeks: 4, testId: "lookback-1m" },
  { label: "3M", weeks: 13, testId: "lookback-3m" },
  { label: "6M", weeks: 26, testId: "lookback-6m" },
  { label: "1Y", weeks: 52, testId: "lookback-1y" },
];

interface LookbackCtx {
  weeks: number;
  setWeeks: (w: number) => void;
  label: string;
  options: LookbackOption[];
}

const LookbackContext = createContext<LookbackCtx | null>(null);

export function LookbackProvider({ children }: { children: ReactNode }) {
  const [weeks, setWeeks] = useState(13); // Default: 3M

  const label = LOOKBACK_OPTIONS.find((o) => o.weeks === weeks)?.label ?? "3M";

  return (
    <LookbackContext.Provider value={{ weeks, setWeeks, label, options: LOOKBACK_OPTIONS }}>
      {children}
    </LookbackContext.Provider>
  );
}

export function useLookback(): LookbackCtx {
  const ctx = useContext(LookbackContext);
  if (!ctx) throw new Error("useLookback must be used inside LookbackProvider");
  return ctx;
}
