import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useScope } from "@/components/ScopeProvider";
import { Users, Check, X, Loader2 } from "lucide-react";

type Status = "loading" | "preview" | "joining" | "done" | "error";

/**
 * Landing page for a household invite link (#/join-household/:code).
 * Intentionally requires an explicit button press to accept — opening
 * the link alone never joins anyone to a household.
 */
export default function JoinHousehold({ code }: { code: string }) {
  const [, navigate] = useLocation();
  const { refetchHousehold, setScope } = useScope();
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [inviterName, setInviterName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest("GET", `/api/household/invite/${encodeURIComponent(code)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!data.ok) {
          setError(data.error || "This invite isn't valid.");
          setStatus("error");
          return;
        }
        setInviterName(data.inviterName ?? null);
        setStatus("preview");
      } catch {
        if (!cancelled) {
          setError("Couldn't load this invite.");
          setStatus("error");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  const accept = async () => {
    setStatus("joining");
    try {
      const res = await apiRequest("POST", "/api/household/join", { code });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Couldn't join this household.");
        setStatus("error");
        return;
      }
      await refetchHousehold();
      setScope("shared");
      setStatus("done");
    } catch {
      setError("Couldn't join this household.");
      setStatus("error");
    }
  };

  return (
    <div className="max-w-md mx-auto mt-16 rounded-xl border border-border bg-card/60 p-6 text-center" data-testid="section-join-household">
      <Users size={22} className="mx-auto text-blue mb-3" />

      {status === "loading" && (
        <p className="text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Checking invite…
        </p>
      )}

      {status === "preview" && (
        <>
          <h1 className="font-display text-lg mb-2">
            {inviterName ? `${inviterName} wants to share Life OS with you.` : "You've been invited to a shared household."}
          </h1>
          <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
            Shared view merges Music and Events between you two automatically — either of you can turn a domain off
            later in Settings without leaving the household. Finance stays private account-by-account — nothing there
            shows up until each of you turns it on in Settings.
          </p>
          <button
            type="button"
            data-testid="button-accept-household-invite"
            onClick={accept}
            className="inline-flex items-center gap-2 rounded-full bg-blue text-white px-4 py-2 text-sm font-medium hover:opacity-90 transition"
          >
            <Check size={14} /> Join household
          </button>
        </>
      )}

      {status === "joining" && (
        <p className="text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Joining…
        </p>
      )}

      {status === "done" && (
        <>
          <h1 className="font-display text-lg mb-2">You're in.</h1>
          <p className="text-sm text-muted-foreground mb-5">
            Flip the Shared pill up top any time to see combined data.
          </p>
          <button
            type="button"
            data-testid="button-go-home-after-join"
            onClick={() => navigate("/")}
            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-accent transition"
          >
            Go to Home
          </button>
        </>
      )}

      {status === "error" && (
        <>
          <X size={18} className="mx-auto text-rose mb-2" />
          <p className="text-sm text-muted-foreground" data-testid="text-join-household-error">{error}</p>
        </>
      )}
    </div>
  );
}
