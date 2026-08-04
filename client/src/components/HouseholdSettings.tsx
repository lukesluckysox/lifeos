import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useScope } from "./ScopeProvider";
import { Users, Copy, Check, LogOut, Eye, EyeOff } from "lucide-react";

interface PlaidItemRow {
  id: number;
  itemId: string;
  institutionName: string | null;
  createdAt: number;
}
interface CashAccountRow {
  id: number;
  name: string;
  institution: string | null;
  balance: number;
  includeInPortfolio: boolean;
}
interface VisibilitySetting {
  accountType: string;
  accountRef: string;
  visible: boolean;
}
interface DomainShareSettings {
  music: boolean;
  events: boolean;
}

/**
 * Turns whatever apiRequest() threw into an actionable message. See the
 * matching helper in HouseholdScopePill.tsx for the full explanation —
 * duplicated here rather than shared, same precedent as household-routes.ts's
 * local tmFetch copy.
 */
function describeInviteError(e: any): string {
  const raw = String(e?.message ?? "");
  if (/<!doctype/i.test(raw) || /^\s*</.test(raw) || /unexpected token/i.test(raw)) {
    return "The invite endpoint isn't returning JSON — registerHouseholdRoutes(app) is likely missing from server/routes.ts (the request is falling through to the app's HTML shell instead of hitting a real handler). See INTEGRATION.md.";
  }
  const colonIdx = raw.indexOf(": ");
  const status = colonIdx > -1 ? raw.slice(0, colonIdx) : "";
  const bodyText = colonIdx > -1 ? raw.slice(colonIdx + 2) : raw;
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed?.message) return parsed.message;
  } catch {}
  if (status === "404") {
    return "Invite endpoint not found (404). registerHouseholdRoutes(app) is likely missing from server/routes.ts — see INTEGRATION.md.";
  }
  return bodyText || raw || "Couldn't create an invite link.";
}

/**
 * Household section for the Settings page: invite/leave a household,
 * and per-account visibility toggles that decide what a partner sees in
 * the combined Shared net worth. Drop <HouseholdSettings /> in wherever
 * Settings.tsx renders its other account-management cards (near
 * PlaidConnect / SpotifyConnect).
 */
export function HouseholdSettings() {
  const { household, refetchHousehold } = useScope();
  const queryClient = useQueryClient();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: plaidItems = [] } = useQuery<PlaidItemRow[]>({
    queryKey: ["/api/plaid/items"],
    queryFn: async () => (await apiRequest("GET", "/api/plaid/items")).json(),
  });

  const { data: cashAccounts = [] } = useQuery<CashAccountRow[]>({
    queryKey: ["/api/cash-accounts"],
    queryFn: async () => (await apiRequest("GET", "/api/cash-accounts")).json(),
  });

  const { data: visData } = useQuery<{ settings: VisibilitySetting[] }>({
    queryKey: ["/api/household/visibility"],
    queryFn: async () => (await apiRequest("GET", "/api/household/visibility")).json(),
    enabled: !!household,
  });

  const { data: domainData } = useQuery<{ settings: DomainShareSettings }>({
    queryKey: ["/api/household/domain-shares"],
    queryFn: async () => (await apiRequest("GET", "/api/household/domain-shares")).json(),
    enabled: !!household,
  });
  const domainSettings: DomainShareSettings = domainData?.settings ?? { music: true, events: true };

  const visMap = new Map((visData?.settings ?? []).map(s => [`${s.accountType}:${s.accountRef}`, s.visible]));
  const manualVisible = visMap.get("manual:manual") ?? false;

  const setVisible = async (accountType: string, accountRef: string, visible: boolean) => {
    await apiRequest("POST", "/api/household/visibility", { accountType, accountRef, visible });
    queryClient.invalidateQueries({ queryKey: ["/api/household/visibility"] });
    queryClient.invalidateQueries({ queryKey: ["/api/household/net-worth"] });
  };

  const setDomainShared = async (domain: keyof DomainShareSettings, shared: boolean) => {
    await apiRequest("POST", "/api/household/domain-shares", { domain, shared });
    queryClient.invalidateQueries({ queryKey: ["/api/household/domain-shares"] });
    queryClient.invalidateQueries({ queryKey: ["/api/household/music"] });
    queryClient.invalidateQueries({ queryKey: ["/api/household/concerts-for-you"] });
  };

  const getInvite = async () => {
    setInviteLoading(true);
    setInviteError(null);
    try {
      const res = await apiRequest("POST", "/api/household/invite");
      // apiRequest already throws for any non-2xx before returning
      // (see @/lib/queryClient — it reads res.text(), not res.json()).
      // Reaching here means res.ok, but that doesn't guarantee a JSON
      // body: an unregistered route can fall through to the app's SPA
      // fallback and come back 200 with index.html. Check content-type
      // before parsing so that shows up as an actionable message
      // instead of a raw "Unexpected token '<'" SyntaxError.
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("<!doctype (got an HTML page instead of JSON)");
      }
      const data = await res.json();
      if (!data.url) throw new Error("Server didn't return an invite link.");
      setInviteUrl(data.url);
    } catch (e: any) {
      setInviteUrl(null);
      setInviteError(describeInviteError(e));
    } finally {
      setInviteLoading(false);
    }
  };

  const copyLink = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const leave = async () => {
    await apiRequest("POST", "/api/household/leave");
    await refetchHousehold();
    queryClient.invalidateQueries();
  };

  return (
    <section className="rounded-xl border border-border bg-card/40 p-5" data-testid="section-settings-household">
      <div className="flex items-center gap-2 mb-4">
        <Users size={14} className="text-blue" />
        <h2 className="font-display text-base">Household</h2>
      </div>

      {!household ? (
        <>
          <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
            Invite a partner to build a Shared view — combined Music and Events, plus opt-in Finance sharing.
          </p>
          {inviteError && (
            <div
              className="text-[11px] text-rose leading-relaxed mb-2 rounded border border-rose/30 bg-rose/5 px-2.5 py-2"
              data-testid="text-settings-invite-error"
            >
              {inviteError}
            </div>
          )}
          {!inviteUrl ? (
            <button
              type="button"
              data-testid="button-settings-invite-partner"
              onClick={getInvite}
              disabled={inviteLoading}
              className="rounded-full bg-blue text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition disabled:opacity-60"
            >
              {inviteLoading ? "Generating…" : "Get invite link"}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <div
                className="flex-1 text-[11px] text-muted-foreground break-all rounded border border-border/60 bg-card/40 px-2 py-1.5"
                data-testid="text-settings-invite-url"
              >
                {inviteUrl}
              </div>
              <button
                type="button"
                data-testid="button-settings-copy-invite"
                onClick={copyLink}
                className="rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent transition-colors shrink-0"
              >
                {copied ? <Check size={12} className="text-blue" /> : <Copy size={12} />}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="text-sm mb-4" data-testid="text-household-members">
            Sharing with{" "}
            {household.members
              .map(m => m.displayName)
              .filter(Boolean)
              .join(", ") || "1 other person"}
            .
          </div>

          <div className="eyebrow mb-2">Shared with your household</div>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            The Shared pill up top is the parent switch — flip it and these merge automatically. Turn any one off
            here without leaving the household.
          </p>
          <ul className="space-y-1.5 mb-5">
            <li className="flex items-center justify-between gap-3 text-sm rounded-md border border-border/60 px-3 py-2">
              <span>My Music (recently played, top tracks, pinned tracks)</span>
              <button
                type="button"
                data-testid="button-domain-share-music"
                onClick={() => setDomainShared("music", !domainSettings.music)}
                className={`inline-flex items-center gap-1.5 text-xs rounded-full border px-2.5 py-1 transition ${
                  domainSettings.music ? "border-teal/40 bg-teal/10 text-teal" : "border-border text-muted-foreground"
                }`}
              >
                {domainSettings.music ? <Eye size={12} /> : <EyeOff size={12} />}
                {domainSettings.music ? "Shared" : "Private"}
              </button>
            </li>
            <li className="flex items-center justify-between gap-3 text-sm rounded-md border border-border/60 px-3 py-2">
              <span>My Events matches (followed artists, concerts near you)</span>
              <button
                type="button"
                data-testid="button-domain-share-events"
                onClick={() => setDomainShared("events", !domainSettings.events)}
                className={`inline-flex items-center gap-1.5 text-xs rounded-full border px-2.5 py-1 transition ${
                  domainSettings.events ? "border-teal/40 bg-teal/10 text-teal" : "border-border text-muted-foreground"
                }`}
              >
                {domainSettings.events ? <Eye size={12} /> : <EyeOff size={12} />}
                {domainSettings.events ? "Shared" : "Private"}
              </button>
            </li>
          </ul>

          <div className="eyebrow mb-2">Finance accounts visible to your household</div>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            Off by default. Only accounts you turn on here contribute to the combined Shared net worth — everything
            else stays private to you, even when you're in the household.
          </p>
          <ul className="space-y-1.5 mb-4">
            {plaidItems.map(item => {
              const key = `plaid_item:${item.itemId}`;
              const visible = visMap.get(key) ?? false;
              return (
                <li
                  key={item.itemId}
                  className="flex items-center justify-between gap-3 text-sm rounded-md border border-border/60 px-3 py-2"
                >
                  <span>{item.institutionName || "Connected account"}</span>
                  <button
                    type="button"
                    data-testid={`button-visibility-plaid-${item.itemId}`}
                    onClick={() => setVisible("plaid_item", item.itemId, !visible)}
                    className={`inline-flex items-center gap-1.5 text-xs rounded-full border px-2.5 py-1 transition ${
                      visible ? "border-blue/40 bg-blue/10 text-blue" : "border-border text-muted-foreground"
                    }`}
                  >
                    {visible ? <Eye size={12} /> : <EyeOff size={12} />}
                    {visible ? "Shared" : "Private"}
                  </button>
                </li>
              );
            })}
            <li className="flex items-center justify-between gap-3 text-sm rounded-md border border-border/60 px-3 py-2">
              <span>Manually-entered holdings</span>
              <button
                type="button"
                data-testid="button-visibility-manual"
                onClick={() => setVisible("manual", "manual", !manualVisible)}
                className={`inline-flex items-center gap-1.5 text-xs rounded-full border px-2.5 py-1 transition ${
                  manualVisible ? "border-blue/40 bg-blue/10 text-blue" : "border-border text-muted-foreground"
                }`}
              >
                {manualVisible ? <Eye size={12} /> : <EyeOff size={12} />}
                {manualVisible ? "Shared" : "Private"}
              </button>
            </li>
            {plaidItems.length === 0 && (
              <li className="text-xs text-muted-foreground italic py-1">
                No connected brokerage accounts yet — connect one on Finance to share it here.
              </li>
            )}
            {cashAccounts.filter(a => a.includeInPortfolio).map(acc => {
              const key = `cash_account:${acc.id}`;
              const visible = visMap.get(key) ?? false;
              return (
                <li
                  key={acc.id}
                  className="flex items-center justify-between gap-3 text-sm rounded-md border border-border/60 px-3 py-2"
                >
                  <span>{acc.name}{acc.institution ? ` · ${acc.institution}` : ""}</span>
                  <button
                    type="button"
                    data-testid={`button-visibility-cash-${acc.id}`}
                    onClick={() => setVisible("cash_account", String(acc.id), !visible)}
                    className={`inline-flex items-center gap-1.5 text-xs rounded-full border px-2.5 py-1 transition ${
                      visible ? "border-blue/40 bg-blue/10 text-blue" : "border-border text-muted-foreground"
                    }`}
                  >
                    {visible ? <Eye size={12} /> : <EyeOff size={12} />}
                    {visible ? "Shared" : "Private"}
                  </button>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            data-testid="button-leave-household"
            onClick={leave}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-rose transition-colors"
          >
            <LogOut size={12} /> Leave household
          </button>
        </>
      )}
    </section>
  );
}
