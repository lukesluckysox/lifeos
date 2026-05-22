import { createContext, useContext, useState, ReactNode, useCallback } from "react";

interface LocationContextValue {
  /** The shared city used across Food, Concerts, and Places (Travel). Session-only. */
  city: string;
  setCity: (c: string) => void;
}

const LocationContext = createContext<LocationContextValue | undefined>(undefined);

const DEFAULT_CITY = "Honolulu";

export function LocationProvider({ children }: { children: ReactNode }) {
  const [city, setCityState] = useState<string>(DEFAULT_CITY);
  const setCity = useCallback((c: string) => {
    const trimmed = (c || "").trim();
    if (trimmed) setCityState(trimmed);
  }, []);
  return (
    <LocationContext.Provider value={{ city, setCity }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error("useLocation must be used within LocationProvider");
  return ctx;
}
