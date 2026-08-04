import { useState } from "react";
import { Users, Check, Copy } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useScope } from "./ScopeProvider";
import { apiRequest } from "@/lib/queryClient";

/**
 * Header pill: "Me / Shared" once the user is in a household, or an
 * "Invite partner" affordance if they aren't yet. Drop into AppShell's
 * top utility bar, next to the existing Live/Demo mode pill — same
 * visual language (rounded-full two-segment pill).
 */
export function HouseholdScopePill() {
  const { scope, toggle, household, householdLoading, refetchHousehold } = useScope();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const inHousehold = !!household;

  const handleToggle = () => {
    toggle();
    // Mirrors AppShell's handleModeToggle — every active query refetches
    // scoped to the new value.
    queryClient.invalidateQueries();
  };

  const openInvitePopover = async () => {
    setOpen(o => !o);
    if (!inviteUrl && !inviteLoading) {
      setInviteLoading(true);
      setInviteError(null);
      try {
        const res = await apiRequest("POST", "/api/household/invite");
        // Don't assume 2xx — if the route isn't registered yet
        // (registerHouseholdRoutes(app) missing from routes.ts), this
        // 404s with an HTML body and res.json() below would throw an
        // unhelpful "Unexpected token <" instead of telling you why.
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try { detail = (await res.json())?.message || detail; } catch {}
          throw new Error(detail);
        }
        const data = await res.json();
        if (!data.url) throw new Error("Server didn't return an invite link.");
        setInviteUrl(data.url);
      } catch (e: any) {
        setInviteUrl(null);
        setInviteError(
          e?.message?.includes("404") || /^HTTP 404/.test(e?.message || "")
            ? "Invite endpoint not found (404). registerHouseholdRoutes(app) is likely missing from server/routes.ts — see INTEGRATION.md."
            : e?.message || "Couldn't create an invite link."
        );
      } finally {
        setInviteLoading(false);
      }
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

  if (householdLoading) return null;

  return (
    <div className="relative">
      {inHousehold ? (
        <button
          type="button"
          data-testid="button-scope-toggle"
          onClick={handleToggle}
          aria-label={`Switch to ${scope === "me" ? "shared" : "me"} view`}
          title={
            scope === "me"
              ? "Showing only your data. Click to switch to your shared household view."
              : "Showing combined household data. Click to switch back to just you."
          }
          className="group h-8 inline-flex items-center rounded-full border border-border bg-secondary/40 hover:bg-accent transition-colors p-0.5 font-mono text-[10px] uppercase tracking-wider"
        >
          <span className={`px-2.5 py-1 rounded-full transition-colors ${scope === "me" ? "bg-blue text-white" : "text-muted-foreground"}`}>
            Me
          </span>
          <span className={`px-2.5 py-1 rounded-full transition-colors ${scope === "shared" ? "bg-teal text-background" : "text-muted-foreground"}`}>
            Shared
          </span>
        </button>
      ) : (
        <button
          type="button"
          data-testid="button-invite-partner"
          onClick={openInvitePopover}
          aria-label="Invite your partner"
          title="Invite a partner to build a shared household view."
          className="h-8 inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 hover:bg-accent px-3 transition-colors font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          <Users size={12} className="text-blue" />
          Invite partner
        </button>
      )}

      {open && !inHousehold && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 mt-2 w-72 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg z-40 p-3"
            data-testid="menu-household-invite"
          >
            <div className="eyebrow mb-2">Invite your partner</div>
            {inviteLoading && <div className="text-xs text-muted-foreground">Generating link…</div>}
            {inviteError && (
              <div className="text-[11px] text-rose leading-relaxed" data-testid="text-household-invite-error">
                {inviteError}
              </div>
            )}
            {inviteUrl && (
              <>
                <div
                  className="text-[11px] text-muted-foreground break-all rounded border border-border/60 bg-card/40 px-2 py-1.5 mb-2"
                  data-testid="text-household-invite-url"
                >
                  {inviteUrl}
                </div>
                <button
                  type="button"
                  data-testid="button-copy-household-invite"
                  onClick={copyLink}
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent transition-colors"
                >
                  {copied ? <Check size={12} className="text-blue" /> : <Copy size={12} />}
                  {copied ? "Copied" : "Copy link"}
                </button>
              </>
            )}
            <div className="mt-3 pt-3 border-t border-border/40 text-[10px] text-muted-foreground italic">
              They'll need to sign in and accept before Shared view turns on for either of you. Finance stays private account-by-account until you opt each one in from Settings.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
