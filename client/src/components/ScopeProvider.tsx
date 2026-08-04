import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/components/AuthProvider";

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
  // Starts false, not true: with no signed-in user there's nothing to
  // load, and HouseholdScopePill treats householdLoading=true as "render
  // nothing yet" — leaving this true pre-auth would just hide the pill
  // forever on the Landing page's few authed-adjacent states.
  const [householdLoading, setHouseholdLoading] = useState(false);
  const { user } = useAuth();

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
    // /api/household requires auth — skip the round trip entirely
    // (and the guaranteed 401) while nobody's signed in, e.g. on the
    // pre-auth Landing page that ScopeProvider also wraps.
    if (!user) {
      setHousehold(null);
      setHouseholdLoading(false);
      return;
    }
    setHouseholdLoading(true);
    refetchHousehold();
  }, [user, refetchHousehold]);

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
