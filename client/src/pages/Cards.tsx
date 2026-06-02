import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CreditCard, Trash2, ChevronDown, ChevronUp, DollarSign, Plane, Utensils, ShoppingBag, Building2, Shield, Star, AlertTriangle, Search, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/components/AuthProvider";

/* ── Types ───────────────────────────────────────────────────────────── */
interface CardCatalogItem {
  id: string; name: string; issuer: string; network: string;
  annualFee: number; estimatedAnnualValue: number; color: string; benefitCount: number;
}
interface Benefit {
  id: string; name: string; category: string; description: string;
  annualValue: number; howToUse?: string; recurring?: string;
}
interface CardDefinition extends CardCatalogItem { benefits: Benefit[]; }
interface UserCard { id: number; card_id: string; nickname?: string; definition: CardDefinition | null; }

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  travel:    <Plane size={12} />,
  dining:    <Utensils size={12} />,
  shopping:  <ShoppingBag size={12} />,
  lounge:    <Building2 size={12} />,
  credits:   <DollarSign size={12} />,
  insurance: <Shield size={12} />,
  rewards:   <Star size={12} />,
};

const CATEGORY_COLOR: Record<string, string> = {
  travel:    "text-blue border-blue/30 bg-blue/10",
  dining:    "text-gold border-gold/30 bg-gold/10",
  shopping:  "text-rose border-rose/30 bg-rose/10",
  lounge:    "text-teal border-teal/30 bg-teal/10",
  credits:   "text-green border-green/30 bg-green/10",
  insurance: "text-muted-foreground border-border bg-muted/40",
  rewards:   "text-blue border-blue/30 bg-blue/10",
};

/* ── Card Search Bar ──────────────────────────────────────────────── */
function CardSearch({
  catalog,
  alreadyAdded,
  onAdd,
  adding,
  onClose,
}: {
  catalog: CardCatalogItem[];
  alreadyAdded: Set<string>;
  onAdd: (id: string) => void;
  adding: boolean;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return catalog.filter(c => !alreadyAdded.has(c.id)).slice(0, 8);
    return catalog
      .filter(c => !alreadyAdded.has(c.id))
      .filter(c =>
        c.name.toLowerCase().includes(term) ||
        c.issuer.toLowerCase().includes(term) ||
        c.network.toLowerCase().includes(term)
      )
      .slice(0, 12);
  }, [q, catalog, alreadyAdded]);

  return (
    <div className="dash-card overflow-hidden" data-testid="panel-add-card">
      <div className="dash-card-header flex items-center gap-3 px-4 py-3">
        <Search size={14} className="text-muted-foreground shrink-0" />
        <input
          autoFocus
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search cards — Chase Sapphire, Amex Platinum, Venture X…"
          className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/50"
          data-testid="input-card-search"
        />
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
          <X size={14} />
        </button>
      </div>

      {results.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          {q.trim() ? `No cards matching "${q.trim()}"` : "All available cards already added."}
        </div>
      ) : (
        <div className="divide-y divide-border/40 max-h-80 overflow-y-auto">
          {results.map(card => (
            <button
              key={card.id}
              onClick={() => onAdd(card.id)}
              disabled={adding}
              className="w-full flex items-center gap-3 text-left px-4 py-3 hover:bg-accent/40 transition-colors disabled:opacity-40"
              data-testid={`add-card-${card.id}`}
            >
              {/* Card color swatch */}
              <div className={`w-9 h-6 rounded-md bg-gradient-to-r ${card.color} shrink-0`} />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{card.issuer}</div>
                <div className="text-sm font-semibold truncate">{card.name}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-mono text-muted-foreground">
                  {card.annualFee === 0 ? "No fee" : `$${card.annualFee}/yr`}
                </div>
                <div className="text-[10px] text-muted-foreground/60">{card.benefitCount} benefits</div>
              </div>
            </button>
          ))}
        </div>
      )}

      {!q.trim() && results.length > 0 && (
        <div className="px-4 py-2.5 border-t border-border/40">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">
            {catalog.filter(c => !alreadyAdded.has(c.id)).length} cards available · type to search
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────── */
export default function Cards() {
  const { user } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"my-cards" | "benefits" | "overlap">("my-cards");

  const { data: catalog = [] } = useQuery<CardCatalogItem[]>({
    queryKey: ["/api/cards/catalog"],
    queryFn: async () => (await apiRequest("GET", "/api/cards/catalog")).json(),
  });

  const { data: userCards = [], isLoading } = useQuery<UserCard[]>({
    queryKey: ["/api/cards"],
    queryFn: async () => (await apiRequest("GET", "/api/cards")).json(),
    enabled: !!user,
  });

  const addMutation = useMutation({
    mutationFn: async (cardId: string) => {
      await apiRequest("POST", "/api/cards", { cardId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cards"] });
      setShowAdd(false);
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/cards/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/cards"] }),
  });

  /* ── Derived stats ─────────────────────────────────────────────────── */
  const totalFees = userCards.reduce((s, c) => s + (c.definition?.annualFee ?? 0), 0);
  const totalValue = userCards.reduce((s, c) => s + (c.definition?.estimatedAnnualValue ?? 0), 0);
  const netValue = totalValue - totalFees;

  const allBenefits = userCards.flatMap(c =>
    (c.definition?.benefits ?? []).map(b => ({ ...b, cardName: c.definition?.name ?? "", cardIssuer: c.definition?.issuer ?? "" }))
  );
  const byCategory = allBenefits.reduce<Record<string, typeof allBenefits>>((acc, b) => {
    (acc[b.category] = acc[b.category] ?? []).push(b);
    return acc;
  }, {});

  const overlaps = Object.entries(byCategory)
    .filter(([, benefits]) => benefits.length > 1)
    .map(([cat, benefits]) => ({ category: cat, benefits, totalValue: benefits.reduce((s, b) => s + b.annualValue, 0) }));

  const alreadyAdded = new Set(userCards.map(c => c.card_id));

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="eyebrow mb-2">Wallet</div>
          <h1 className="font-display text-3xl">Credit Cards</h1>
          <p className="mt-1 text-sm text-muted-foreground">Benefits, credits, and what you might be missing.</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:border-blue/30 hover:text-blue transition-colors"
          data-testid="button-add-card"
        >
          {showAdd ? <X size={14} /> : <Search size={14} />}
          {showAdd ? "Close" : "Add card"}
        </button>
      </div>

      {/* Search bar — replaces the old grid catalog */}
      {showAdd && (
        <CardSearch
          catalog={catalog}
          alreadyAdded={alreadyAdded}
          onAdd={(id) => addMutation.mutate(id)}
          adding={addMutation.isPending}
          onClose={() => setShowAdd(false)}
        />
      )}

      {/* Summary stats */}
      {userCards.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Annual fees", value: `$${totalFees.toLocaleString()}`, sub: "total cost", tone: "text-rose" },
            { label: "Est. value", value: `$${totalValue.toLocaleString()}`, sub: "if fully used", tone: "text-green" },
            { label: "Net value", value: `${netValue >= 0 ? "+" : ""}$${netValue.toLocaleString()}`, sub: "value − fees", tone: netValue >= 0 ? "text-blue" : "text-rose" },
          ].map(s => (
            <div key={s.label} className="dash-card p-4">
              <div className="eyebrow mb-1">{s.label}</div>
              <div className={`font-display text-2xl tabular ${s.tone}`}>{s.value}</div>
              <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{s.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      {userCards.length > 0 && (
        <div className="flex gap-1 border-b border-border">
          {(["my-cards", "benefits", "overlap"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-xs font-mono uppercase tracking-wider transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? "border-blue text-blue"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "my-cards" ? "My Cards" : tab === "overlap" ? `Overlap ${overlaps.length > 0 ? `(${overlaps.length})` : ""}` : "Benefits"}
            </button>
          ))}
        </div>
      )}

      {/* My Cards tab */}
      {(activeTab === "my-cards" || userCards.length === 0) && (
        <div className="space-y-3">
          {isLoading && <div className="text-sm text-muted-foreground animate-pulse">Loading...</div>}
          {!isLoading && userCards.length === 0 && (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <CreditCard size={32} className="mx-auto text-muted-foreground/30 mb-3" />
              <div className="text-sm font-medium mb-1">No cards added yet</div>
              <div className="text-xs text-muted-foreground mb-4">Search for your cards to see a unified view of your benefits.</div>
              <button
                onClick={() => setShowAdd(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-blue/30 bg-blue/10 text-blue px-4 py-2 text-sm font-medium hover:bg-blue/20 transition-colors"
              >
                <Search size={14} /> Search cards
              </button>
            </div>
          )}
          {userCards.map(uc => {
            const def = uc.definition;
            const expanded = expandedCard === uc.id.toString();
            return (
              <div key={uc.id} className="dash-card overflow-hidden" data-testid={`card-row-${uc.card_id}`}>
                <div
                  className="dash-card-header flex items-center gap-4 px-4 py-3 cursor-pointer"
                  onClick={() => setExpandedCard(expanded ? null : uc.id.toString())}
                >
                  <div className={`w-10 h-6 rounded bg-gradient-to-r ${def?.color ?? "from-gray-500 to-gray-700"} shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{def?.issuer}</div>
                    <div className="font-semibold text-sm truncate">{def?.name ?? uc.card_id}</div>
                  </div>
                  <div className="text-right shrink-0 hidden sm:block">
                    <div className="text-xs font-mono text-muted-foreground">{def?.annualFee === 0 ? "No fee" : `$${def?.annualFee}/yr`}</div>
                    <div className="text-[10px] text-muted-foreground/60">~${def?.estimatedAnnualValue}/yr value</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {expanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                    <button
                      onClick={(e) => { e.stopPropagation(); removeMutation.mutate(uc.id); }}
                      className="text-muted-foreground/40 hover:text-rose transition-colors p-1"
                      data-testid={`remove-card-${uc.id}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                {expanded && def && (
                  <div className="px-4 py-4 space-y-3">
                    {def.benefits.map(b => (
                      <div key={b.id} className="flex items-start gap-3" data-testid={`benefit-${b.id}`}>
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider shrink-0 mt-0.5 ${CATEGORY_COLOR[b.category] ?? "text-muted-foreground border-border"}`}>
                          {CATEGORY_ICONS[b.category]}
                          {b.category}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{b.name}</div>
                          <div className="text-xs text-muted-foreground leading-relaxed">{b.description}</div>
                          {b.howToUse && (
                            <div className="text-[11px] text-blue/80 mt-1 leading-snug">↳ {b.howToUse}</div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono text-sm tabular text-green">+${b.annualValue}</div>
                          {b.recurring && <div className="text-[9px] font-mono uppercase text-muted-foreground">{b.recurring}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Benefits tab */}
      {activeTab === "benefits" && userCards.length > 0 && (
        <div className="space-y-6">
          {Object.entries(byCategory).sort(([a], [b]) => a.localeCompare(b)).map(([category, benefits]) => (
            <div key={category}>
              <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider mb-3 ${CATEGORY_COLOR[category] ?? "text-muted-foreground border-border"}`}>
                {CATEGORY_ICONS[category]} {category}
              </div>
              <div className="space-y-2">
                {benefits.map(b => (
                  <div key={b.id} className="flex items-start gap-3 rounded-lg border border-border bg-card/60 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{b.name}</span>
                        <span className="text-[10px] font-mono text-muted-foreground/60">{b.cardIssuer} {b.cardName}</span>
                      </div>
                      <div className="text-xs text-muted-foreground leading-relaxed mt-0.5">{b.description}</div>
                    </div>
                    <div className="font-mono text-sm tabular text-green shrink-0">+${b.annualValue}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Overlap tab */}
      {activeTab === "overlap" && userCards.length > 0 && (
        <div className="space-y-4">
          {overlaps.length === 0 ? (
            <div className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">
              No benefit overlaps detected across your cards.
            </div>
          ) : (
            <>
              <div className="text-sm text-muted-foreground leading-relaxed">
                These benefit categories appear across multiple cards. You may be paying for overlapping value.
              </div>
              {overlaps.map(o => (
                <div key={o.category} className="dash-card overflow-hidden">
                  <div className="dash-card-header flex items-center justify-between px-4 py-3">
                    <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider ${CATEGORY_COLOR[o.category] ?? "text-muted-foreground border-border"}`}>
                      {CATEGORY_ICONS[o.category]} {o.category}
                    </div>
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={12} className="text-gold" />
                      <span className="text-[10px] font-mono text-gold">{o.benefits.length} cards overlap</span>
                    </div>
                  </div>
                  <div className="px-4 py-3 space-y-2">
                    {o.benefits.map(b => (
                      <div key={b.id} className="flex items-start justify-between gap-3">
                        <div>
                          <span className="text-sm">{b.name}</span>
                          <span className="text-[10px] font-mono text-muted-foreground ml-2">{b.cardIssuer} {b.cardName}</span>
                        </div>
                        <span className="font-mono text-xs tabular text-green shrink-0">+${b.annualValue}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
