import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePlaidLink } from "react-plaid-link";
import { Building2, Trash2, Plus, AlertCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface PlaidItem {
  id: number;
  itemId: string;
  institutionName: string | null;
  createdAt: number;
}

/**
 * Plaid OAuth return detection.
 *
 * When Plaid sends the user back from an OAuth bank (Chase, BoA, etc.),
 * the URL has `?oauth_state_id=...` on the server-side path — but our app
 * uses hash routing, so the URL ends up looking like:
 *   https://thelifeos.up.railway.app/?oauth_state_id=xxx#/finance
 * OR (when redirect_uri preserved hash) inside the hash.
 *
 * We check both window.location.search AND window.location.hash for the
 * param.
 */
function isPlaidOAuthReturn(): boolean {
  if (typeof window === "undefined") return false;
  return /[?&]oauth_state_id=/.test(window.location.search + window.location.hash);
}

function PlaidLinkButton({ onSuccess, disabled }: { onSuccess: (publicToken: string, institutionName: string) => void; disabled?: boolean }) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [autoOpened, setAutoOpened] = useState(false);
  // Locked to whatever isPlaidOAuthReturn() was on first mount — we don't
  // want this to flip back to false after we clean the URL.
  const [isOAuthReturn] = useState<boolean>(isPlaidOAuthReturn);

  const fetchLinkToken = useCallback(async () => {
    try {
      const res = await apiRequest("POST", "/api/plaid/link-token");
      const data = await res.json();
      if (data.error) { setFetchError(data.error); return; }
      setLinkToken(data.linkToken);
    } catch (e: any) {
      setFetchError(e.message);
    }
  }, []);

  // On OAuth return, fetch the ORIGINAL link_token that was used to start
  // the flow. Plaid requires the same token to resume — a fresh token
  // would not match the OAuth state and Plaid Link would render blank
  // (the dreaded "blue screen").
  const resumeOAuthLink = useCallback(async () => {
    try {
      const res = await apiRequest("GET", "/api/plaid/link-token-current");
      if (!res.ok) {
        // No in-flight token — fall back to a fresh one. User will likely
        // need to start the flow again, but at least the page isn't blank.
        setFetchError(
          "Plaid OAuth session expired. Please try connecting your account again.",
        );
        return;
      }
      const data = await res.json();
      setLinkToken(data.linkToken);
    } catch (e: any) {
      setFetchError(e.message);
    }
  }, []);

  const { open, ready, error: linkError } = usePlaidLink({
    token: linkToken || "",
    // Critical for OAuth resume — pass the full current URL so Plaid Link
    // can pick up oauth_state_id and complete the flow.
    receivedRedirectUri: isOAuthReturn ? window.location.href : undefined,
    onSuccess: (publicToken, metadata) => {
      const institutionName = metadata.institution?.name || "Unknown";
      onSuccess(publicToken, institutionName);
      setLinkToken(null);
      setAutoOpened(false);
      // Clean up the oauth_state_id from URL so the next mount doesn't
      // try to resume again.
      if (isOAuthReturn && typeof window !== "undefined") {
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState(null, "", cleanUrl);
      }
    },
    onExit: (err) => {
      if (err) console.error("[plaid-link-exit]", err);
      setLinkToken(null);
      setAutoOpened(false);
      if (isOAuthReturn && typeof window !== "undefined") {
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState(null, "", cleanUrl);
      }
    },
    onEvent: (eventName) => {
      if (eventName === "ERROR" || eventName === "EXIT") {
        console.log("[plaid-link-event]", eventName);
      }
    },
  });

  // OAuth return: immediately fetch the stashed link_token on mount.
  useEffect(() => {
    if (isOAuthReturn && !linkToken && !fetchError) {
      resumeOAuthLink();
    }
  }, [isOAuthReturn, linkToken, fetchError, resumeOAuthLink]);

  // Auto-open when token is ready — but only once per token.
  useEffect(() => {
    if (linkToken && ready && !autoOpened) {
      setAutoOpened(true);
      open();
    }
  }, [linkToken, ready, autoOpened, open]);

  // Surface Plaid initialization errors instead of going blank
  useEffect(() => {
    if (linkError) {
      setFetchError(linkError.message || "Plaid Link failed to initialize");
      setLinkToken(null);
      setAutoOpened(false);
    }
  }, [linkError]);

  const handleClick = async () => {
    if (!linkToken) {
      setAutoOpened(false);
      await fetchLinkToken();
    }
  };

  if (fetchError) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="text-plaid-error">
        <AlertCircle size={12} className="text-amber-400" />
        <span>Plaid unavailable: {fetchError}</span>
      </div>
    );
  }

  // OAuth return loading state — give visible feedback while the resume
  // round-trip happens. Without this the user just sees nothing.
  if (isOAuthReturn && !linkToken) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="text-plaid-resuming">
        <span className="inline-block h-2 w-2 rounded-full bg-teal animate-pulse" />
        <span>Resuming brokerage connection…</span>
      </div>
    );
  }
  if (isOAuthReturn && linkToken && !ready) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="text-plaid-finalizing">
        <span className="inline-block h-2 w-2 rounded-full bg-teal animate-pulse" />
        <span>Finishing connection…</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid="button-plaid-connect"
      onClick={handleClick}
      disabled={disabled || !!(linkToken && !ready)}
      className="inline-flex items-center gap-2 rounded-md bg-teal/15 border border-teal/30 text-teal px-3 py-1.5 text-xs font-medium hover:bg-teal/25 disabled:opacity-40 transition-colors"
    >
      <Plus size={12} />
      Connect brokerage
    </button>
  );
}

export function PlaidConnect() {
  const qc = useQueryClient();

  const { data: items = [], isLoading } = useQuery<PlaidItem[]>({
    queryKey: ["/api/plaid/items"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/plaid/items");
      return res.json();
    },
  });

  const exchangeMutation = useMutation({
    mutationFn: async ({ publicToken, institutionName }: { publicToken: string; institutionName: string }) => {
      const res = await apiRequest("POST", "/api/plaid/exchange", { publicToken, institutionName });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/plaid/items"] });
      qc.invalidateQueries({ queryKey: ["/api/portfolio"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await apiRequest("DELETE", `/api/plaid/items/${itemId}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/plaid/items"] });
      qc.invalidateQueries({ queryKey: ["/api/portfolio"] });
    },
  });

  const handlePlaidSuccess = (publicToken: string, institutionName: string) => {
    exchangeMutation.mutate({ publicToken, institutionName });
  };

  if (isLoading) return null;

  // No items connected — show banner
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-gold/30 bg-gold/5 p-5 space-y-3" data-testid="banner-plaid-connect">
        <div>
          <div className="font-display text-base">Connect your brokerage</div>
          <div className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-md">
            Link your investment accounts via Plaid to see your real portfolio instead of demo data. Connect as many as you want — one bank at a time, then come back and link another.
          </div>
        </div>
        <PlaidLinkButton onSuccess={handlePlaidSuccess} disabled={exchangeMutation.isPending} />
        {exchangeMutation.isPending && (
          <p className="text-xs text-muted-foreground">Connecting account…</p>
        )}
        {exchangeMutation.isError && (
          <p className="text-xs text-red-400">Connection failed. Try again.</p>
        )}
      </div>
    );
  }

  // Items connected — show list + explicit "Add another" affordance
  return (
    <div className="rounded-lg border border-teal/30 bg-teal/5 p-5 space-y-4" data-testid="section-plaid-connected">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-sm text-teal font-medium">
            <Building2 size={14} />
            <span data-testid="text-brokerages-count">
              {items.length} brokerage{items.length > 1 ? "s" : ""} connected
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            Link as many investment accounts as you like — Fidelity, Schwab, Robinhood, Coinbase, all welcome.
          </div>
        </div>
      </div>
      <ul className="space-y-1.5">
        {items.map(item => (
          <li key={item.id} className="flex items-center justify-between text-xs text-muted-foreground py-1">
            <span className="flex items-center gap-1.5">
              <Building2 size={10} className="text-teal/60" />
              <span data-testid={`text-brokerage-name-${item.id}`}>{item.institutionName || "Unknown institution"}</span>
            </span>
            <button
              type="button"
              data-testid={`button-plaid-disconnect-${item.id}`}
              onClick={() => deleteMutation.mutate(item.itemId)}
              disabled={deleteMutation.isPending}
              className="text-muted-foreground/60 hover:text-red-400 transition-colors p-1"
              aria-label="Disconnect"
            >
              <Trash2 size={11} />
            </button>
          </li>
        ))}
      </ul>
      <div className="pt-3 border-t border-teal/20 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[11px] text-muted-foreground">Have another account at a different bank?</span>
        <PlaidLinkButton onSuccess={handlePlaidSuccess} disabled={exchangeMutation.isPending} />
      </div>
      {exchangeMutation.isPending && (
        <p className="text-xs text-muted-foreground">Connecting account…</p>
      )}
      {exchangeMutation.isError && (
        <p className="text-xs text-red-400">Connection failed. Try again.</p>
      )}
    </div>
  );
}
