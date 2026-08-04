import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { apiRequest } from "@/lib/queryClient";

export type Scope = "me" | "shared";

export interface HouseholdMember {
  id: number;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface Household {
  id: number;
  name: string | null;
  members: HouseholdMember[];
}

interface ScopeContextValue {
  scope: Scope;
  setScope: (s: Scope) => void;
  toggle: () => void;
  /** Append ?scope=shared (or &scope=shared) to a URL when in shared mode. No-op for "me". Mirrors ModeProvider's withMode. */
  withScope: (url: string) => string;
  household: Household | null;
  householdLoading: boolean;
  refetchHousehold: () => Promise<void>;
}

const ScopeContext = createContext<ScopeContextValue | undefined>(undefined);

export function ScopeProvider({ children }: { children: ReactNode }) {
  // Session-only — always starts "me" on every page load, same convention as ModeProvider.
  const [scope, setScope] = useState<Scope>("me");
  const [household, setHousehold] = useState<Household | null>(null);
  const [householdLoading, setHouseholdLoading] = useState(true);

  const refetchHousehold = useCallback(async () => {
    try {
      const res = await apiRequest("GET", "/api/household");
      const data = await res.json();
      setHousehold(data.household ?? null);
    } catch {
      setHousehold(null);
    } finally {
      setHouseholdLoading(false);
    }
  }, []);

  useEffect(() => {
    refetchHousehold();
  }, [refetchHousehold]);

  const toggle = () => setScope(s => (s === "me" ? "shared" : "me"));

  const withScope = (url: string) => {
    if (scope === "me") return url;
    return url + (url.includes("?") ? "&" : "?") + "scope=shared";
  };

  return (
    <ScopeContext.Provider value={{ scope, setScope, toggle, withScope, household, householdLoading, refetchHousehold }}>
      {children}
    </ScopeContext.Provider>
  );
}

export function useScope() {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error("useScope must be used within ScopeProvider");
  return ctx;
}
