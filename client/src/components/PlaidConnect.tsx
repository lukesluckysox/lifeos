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
  return <PlaidLinkButtonInner onSuccess={onSuccess} disabled={disabled} />;
}

/**
 * Inner component is gated on having a non-empty linkToken before
 * mounting usePlaidLink — otherwise the Plaid SDK initializes with
 * token="" + receivedRedirectUri set, which is exactly the state that
 * shows a blank blue screen on OAuth bank return.
 */
function PlaidLinkButtonInner({ onSuccess, disabled }: { onSuccess: (publicToken: string, institutionName: string) => void; disabled?: boolean }) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [autoOpened, setAutoOpened] = useState(false);
  // Locked to whatever isPlaidOAuthReturn() was on first mount — we don't
  // want this to flip back to false after we clean the URL.
  const [isOAuthReturn] = useState<boolean>(isPlaidOAuthReturn);

  // Without a non-empty token there is nothing for Plaid Link to mount
  // on. Render a lightweight placeholder while we either:
  //   - fetch a fresh link_token (button click path), or
  //   - resume an OAuth flow by fetching the stashed token.
  // Once linkToken is set, we render <PlaidLinkMounted/> which calls
  // usePlaidLink with valid inputs.
  if (!linkToken) {
    return (
      <PlaidLinkBootstrap
        isOAuthReturn={isOAuthReturn}
        fetchError={fetchError}
        autoOpened={autoOpened}
        onFetchError={setFetchError}
        onResetAutoOpened={() => setAutoOpened(false)}
        onLinkToken={setLinkToken}
        disabled={disabled}
      />
    );
  }

  return (
    <PlaidLinkMounted
      linkToken={linkToken}
      isOAuthReturn={isOAuthReturn}
      autoOpened={autoOpened}
      setAutoOpened={setAutoOpened}
      onSuccess={(pt, inst) => {
        onSuccess(pt, inst);
        setLinkToken(null);
        setAutoOpened(false);
      }}
      onExit={() => {
        setLinkToken(null);
        setAutoOpened(false);
      }}
      onInitError={(msg) => {
        setFetchError(msg);
        setLinkToken(null);
        setAutoOpened(false);
      }}
      disabled={disabled}
    />
  );
}

function PlaidLinkBootstrap({
  isOAuthReturn,
  fetchError,
  autoOpened,
  onFetchError,
  onResetAutoOpened,
  onLinkToken,
  disabled,
}: {
  isOAuthReturn: boolean;
  fetchError: string | null;
  autoOpened: boolean;
  onFetchError: (msg: string | null) => void;
  onResetAutoOpened: () => void;
  onLinkToken: (token: string) => void;
  disabled?: boolean;
}) {
  const [debugInfo, setDebugInfo] = useState<string>("");

  const fetchLinkToken = useCallback(async () => {
    try {
      const res = await apiRequest("POST", "/api/plaid/link-token");
      const data = await res.json();
      if (data.error) { onFetchError(data.error); return; }
      onLinkToken(data.linkToken);
    } catch (e: any) {
      onFetchError(e.message);
    }
  }, [onFetchError, onLinkToken]);

  // On OAuth return, fetch the ORIGINAL link_token that was used to start
  // the flow. Plaid requires the same token to resume — a fresh token
  // would not match the OAuth state and Plaid Link would render blank
  // (the dreaded "blue screen").
  const resumeOAuthLink = useCallback(async () => {
    setDebugInfo("resume: fetching inflight token\u2026");
    try {
      const res = await apiRequest("GET", "/api/plaid/link-token-current");
      const bodyText = await res.text();
      let body: any = null;
      try { body = JSON.parse(bodyText); } catch {}

      if (!res.ok) {
        setDebugInfo(`resume: HTTP ${res.status} — body: ${bodyText.slice(0,200)}`);
        onFetchError(
          `Plaid OAuth resume failed (HTTP ${res.status}). ${bodyText.slice(0,120)}`,
        );
        // Strip the oauth_state_id so a refresh doesn't loop on the
        // resume path again.
        if (typeof window !== "undefined") {
          const cleanUrl = window.location.pathname + (window.location.hash || "");
          window.history.replaceState(null, "", cleanUrl);
        }
        return;
      }
      if (!body?.linkToken) {
        setDebugInfo(`resume: 200 but no linkToken in body: ${bodyText.slice(0,200)}`);
        onFetchError("Plaid OAuth session expired. Please try connecting again.");
        return;
      }
      setDebugInfo(`resume: got linkToken — mounting Plaid Link…`);
      onLinkToken(body.linkToken);
    } catch (e: any) {
      setDebugInfo(`resume: threw — ${e?.message || String(e)}`);
      onFetchError(e.message);
    }
  }, [onFetchError, onLinkToken]);

  // OAuth return: immediately fetch the stashed link_token on mount.
  useEffect(() => {
    if (isOAuthReturn && !fetchError) {
      resumeOAuthLink();
    }
  }, [isOAuthReturn, fetchError, resumeOAuthLink]);

  if (fetchError) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="text-plaid-error">
        <AlertCircle size={12} className="text-amber-400" />
        <span>Plaid unavailable: {fetchError}</span>
      </div>
    );
  }

  if (isOAuthReturn) {
    return (
      <div className="space-y-2" data-testid="text-plaid-resuming">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full bg-teal animate-pulse" />
          <span>Resuming brokerage connection…</span>
        </div>
        {debugInfo && (
          <div className="text-[10px] font-mono text-muted-foreground/60 break-all">
            {debugInfo}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid="button-plaid-connect"
      onClick={() => {
        onResetAutoOpened();
        fetchLinkToken();
      }}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-md bg-teal/15 border border-teal/30 text-teal px-3 py-1.5 text-xs font-medium hover:bg-teal/25 disabled:opacity-40 transition-colors"
    >
      <Plus size={12} />
      Connect brokerage
    </button>
  );
}

function PlaidLinkMounted({
  linkToken,
  isOAuthReturn,
  autoOpened,
  setAutoOpened,
  onSuccess,
  onExit,
  onInitError,
  disabled,
}: {
  linkToken: string;
  isOAuthReturn: boolean;
  autoOpened: boolean;
  setAutoOpened: (v: boolean) => void;
  onSuccess: (publicToken: string, institutionName: string) => void;
  onExit: () => void;
  onInitError: (msg: string) => void;
  disabled?: boolean;
}) {

  // CRITICAL: receivedRedirectUri must EXACTLY match the redirect_uri
  // registered in the Plaid Dashboard (bare origin + ?oauth_state_id=xxx).
  // App.tsx stashes the original href on window before rewriting the URL
  // to /#/finance — we read it back here. Passing the rewritten
  // /#/finance URL would make Plaid render blank.
  const originalRedirectUri =
    typeof window !== "undefined"
      ? ((window as any).__plaidOriginalRedirectUri as string | undefined)
      : undefined;

  const { open, ready, error: linkError } = usePlaidLink({
    token: linkToken,
    receivedRedirectUri: isOAuthReturn
      ? (originalRedirectUri || window.location.href)
      : undefined,
    onSuccess: (publicToken, metadata) => {
      const institutionName = metadata.institution?.name || "Unknown";
      onSuccess(publicToken, institutionName);
      // Clean up the oauth_state_id from URL + stashed redirect so the
      // next mount doesn't try to resume again.
      if (isOAuthReturn && typeof window !== "undefined") {
        const hashClean = window.location.hash.split("?")[0] || "#/finance";
        window.history.replaceState(null, "", window.location.pathname + hashClean);
        delete (window as any).__plaidOriginalRedirectUri;
      }
    },
    onExit: (err) => {
      if (err) console.error("[plaid-link-exit]", err);
      onExit();
      if (isOAuthReturn && typeof window !== "undefined") {
        const hashClean = window.location.hash.split("?")[0] || "#/finance";
        window.history.replaceState(null, "", window.location.pathname + hashClean);
        delete (window as any).__plaidOriginalRedirectUri;
      }
    },
    onEvent: (eventName) => {
      if (eventName === "ERROR" || eventName === "EXIT") {
        console.log("[plaid-link-event]", eventName);
      }
    },
  });

  // Auto-open when token is ready — but only once per token.
  useEffect(() => {
    if (ready && !autoOpened) {
      setAutoOpened(true);
      open();
    }
  }, [ready, autoOpened, open]);

  // Surface Plaid initialization errors instead of going blank
  useEffect(() => {
    if (linkError) {
      onInitError(linkError.message || "Plaid Link failed to initialize");
    }
  }, [linkError, onInitError]);

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="text-plaid-finalizing">
      <span className="inline-block h-2 w-2 rounded-full bg-teal animate-pulse" />
      <span>{isOAuthReturn ? "Finishing connection…" : "Opening Plaid…"}</span>
    </div>
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
