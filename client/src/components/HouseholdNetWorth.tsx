import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useScope } from "./ScopeProvider";
import { Users } from "lucide-react";

interface MemberBreakdown {
  userId: number;
  displayName: string | null;
  value: number;
  accountsIncluded: number;
  accountsHidden: number;
}
interface HouseholdNetWorthResp {
  inHousehold: boolean;
  totalValue?: number;
  perMember?: MemberBreakdown[];
  asOf?: string;
}

/**
 * Combined household net worth — renders only when scope === "shared"
 * and the user is in a household. Drop into Finance.tsx (near the
 * existing net-worth hero) and/or Home.tsx's finance card.
 *
 * Shows a per-person breakdown rather than one blended number, on
 * purpose — a combined total with no attribution creates confusion
 * ("whose money moved?"), not trust.
 */
export function HouseholdNetWorth() {
  const { scope, household } = useScope();

  const { data } = useQuery<HouseholdNetWorthResp>({
    queryKey: ["/api/household/net-worth"],
    queryFn: async () => (await apiRequest("GET", "/api/household/net-worth")).json(),
    enabled: scope === "shared" && !!household,
  });

  if (scope !== "shared" || !household || !data?.inHousehold) return null;

  return (
    <section className="rounded-xl border border-teal/20 bg-teal/5 p-5" data-testid="section-household-net-worth">
      <div className="flex items-center gap-2 mb-1">
        <Users size={13} className="text-teal" />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-teal">Shared · household net worth</span>
      </div>
      <div className="font-display text-2xl leading-none tabular mb-4" data-testid="text-household-net-worth">
        ${(data.totalValue ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {(data.perMember ?? []).map(m => (
          <div key={m.userId} className="rounded-md border border-border/40 px-3 py-2">
            <div className="text-xs text-muted-foreground mb-0.5">{m.displayName || "Household member"}</div>
            <div className="font-mono text-sm tabular">
              ${m.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
            {m.accountsHidden > 0 && (
              <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                {m.accountsHidden} account{m.accountsHidden === 1 ? "" : "s"} kept private
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
