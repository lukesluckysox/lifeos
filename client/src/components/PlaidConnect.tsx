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

function PlaidLinkButton({ onSuccess, disabled }: { onSuccess: (publicToken: string, institutionName: string) => void; disabled?: boolean }) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // If we're returning from a Plaid OAuth flow, the URL will contain
  // ?oauth_state_id=... — we need to re-initialize Plaid Link with the
  // original token + the current URL so it can resume.
  const isOAuthReturn = typeof window !== "undefined" && /[?&]oauth_state_id=/.test(window.location.search + window.location.hash);

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

  const [autoOpened, setAutoOpened] = useState(false);

  const { open, ready, error: linkError } = usePlaidLink({
    token: linkToken || "",
    receivedRedirectUri: isOAuthReturn ? window.location.href : undefined,
    onSuccess: (publicToken, metadata) => {
      const institutionName = metadata.institution?.name || "Unknown";
      onSuccess(publicToken, institutionName);
      setLinkToken(null);
      setAutoOpened(false);
    },
    onExit: (err) => {
      if (err) console.error("[plaid-link-exit]", err);
      setLinkToken(null);
      setAutoOpened(false);
    },
    onEvent: (eventName) => {
      // Useful for debugging the blue-screen case
      if (eventName === "ERROR" || eventName === "EXIT") {
        console.log("[plaid-link-event]", eventName);
      }
    },
  });

  // Auto-open when token is ready — but ONLY ONCE per token (not every render)
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
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <AlertCircle size={12} className="text-amber-400" />
        <span>Plaid unavailable: {fetchError}</span>
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
            Link your investment accounts via Plaid to see your real portfolio instead of demo data.
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

  // Items connected — show collapsed list
  return (
    <div className="rounded-lg border border-teal/30 bg-teal/5 p-4 space-y-3" data-testid="section-plaid-connected">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-teal">
          <Building2 size={14} />
          <span>{items.length} brokerage{items.length > 1 ? "s" : ""} connected</span>
        </div>
        <PlaidLinkButton onSuccess={handlePlaidSuccess} disabled={exchangeMutation.isPending} />
      </div>
      <ul className="space-y-1.5">
        {items.map(item => (
          <li key={item.id} className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Building2 size={10} className="text-teal/60" />
              {item.institutionName || "Unknown institution"}
            </span>
            <button
              type="button"
              data-testid={`button-plaid-disconnect-${item.id}`}
              onClick={() => deleteMutation.mutate(item.itemId)}
              disabled={deleteMutation.isPending}
              className="text-muted-foreground/60 hover:text-red-400 transition-colors"
              aria-label="Disconnect"
            >
              <Trash2 size={11} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
