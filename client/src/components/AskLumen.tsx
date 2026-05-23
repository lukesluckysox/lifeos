import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Sparkles, X, Send, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

/**
 * Floating "Ask Lumen" assistant.
 *
 * - Bottom-right button on all authed pages.
 * - Slide-in panel with prompt input + answer.
 * - Auto-collects page context (current route, current portfolio/watchlist) and sends to /api/ask-lumen.
 * - Listens for window event "open-ask-lumen" (dispatched from CommandPalette).
 */
export function AskLumen() {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState<string>("");
  const [location] = useLocation();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // External trigger (command palette)
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("open-ask-lumen", handler);
    return () => window.removeEventListener("open-ask-lumen", handler);
  }, []);

  // Focus when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const submit = async () => {
    const p = prompt.trim();
    if (!p || loading) return;
    setLoading(true);
    setAnswer("");
    try {
      // Server reads holdings/watchlist/subscriptions/places/music itself.
      // We only tell it which page the user is on for context.
      const r = await apiRequest("POST", "/api/ask-lumen", { prompt: p, page: location });
      const j = await r.json();
      setAnswer(j.answer || "(empty response)");
      setModel(j.model || "");
    } catch (e: any) {
      // Friendly error: never expose JSON / status codes / stack traces.
      const msg = String(e?.message || "").toLowerCase();
      if (msg.includes("401") || msg.includes("unauth")) {
        setAnswer("You need to sign back in for Lumen to read your data.");
      } else if (msg.includes("network") || msg.includes("fetch")) {
        setAnswer("Lumen couldn't reach the server. Check your connection and try again.");
      } else if (msg.includes("api key") || msg.includes("anthropic") || msg.includes("claude")) {
        setAnswer("Lumen is offline right now — the AI model is unreachable. Try again in a moment.");
      } else {
        setAnswer("Something went wrong on Lumen's end. Give it another try in a moment.");
      }
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="button-ask-lumen"
        aria-label="Ask Lumen"
        className="fixed bottom-5 right-5 z-40 group flex items-center gap-2 rounded-full bg-teal text-black px-4 py-3 shadow-lg shadow-teal/20 hover:shadow-teal/40 hover:scale-105 transition-all"
      >
        <Sparkles size={16} />
        <span className="text-xs font-mono uppercase tracking-wider">Ask Lumen</span>
      </button>

      {/* Backdrop + panel */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm animate-fade-in"
            onClick={() => setOpen(false)}
          />
          <aside
            data-testid="panel-ask-lumen"
            className="fixed bottom-0 right-0 top-0 z-50 w-full sm:w-[440px] bg-background border-l border-border flex flex-col animate-slide-in-right"
            role="dialog"
            aria-label="Ask Lumen assistant"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-teal" />
                <span className="font-display text-sm">Lumen</span>
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  your assistant
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                data-testid="button-close-ask-lumen"
                className="p-1.5 rounded hover:bg-accent/60"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-5">
              {!answer && !loading && (
                <div className="text-sm text-muted-foreground space-y-3">
                  <p className="text-foreground">What would you like to know?</p>
                  <div className="space-y-2">
                    {[
                      "What's my biggest position and is it overweight?",
                      "Summarize today's movement in my portfolio",
                      "Should I rebalance anything?",
                      "What new artists match my recent listens?",
                    ].map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setPrompt(q)}
                        data-testid={`suggestion-${q.slice(0, 20)}`}
                        className="block w-full text-left rounded border border-border bg-accent/20 hover:bg-accent/50 px-3 py-2 text-xs transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] mt-6 font-mono uppercase tracking-wider text-muted-foreground/60">
                    Tip · ⌘+Enter to send
                  </p>
                </div>
              )}

              {loading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin text-teal" />
                  Thinking…
                </div>
              )}

              {answer && (
                <div className="space-y-3">
                  <div
                    className="text-sm text-foreground whitespace-pre-wrap leading-relaxed"
                    data-testid="text-ask-lumen-answer"
                  >
                    {answer}
                  </div>
                  {model && (
                    <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">
                      via {model}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Input */}
            <div className="border-t border-border p-3">
              <div className="relative">
                <textarea
                  ref={inputRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={onKeyDown}
                  data-testid="input-ask-lumen"
                  placeholder="Ask anything about your life-os…"
                  rows={2}
                  maxLength={2000}
                  className="w-full resize-none rounded border border-border bg-background px-3 py-2 pr-10 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-teal/50"
                />
                <button
                  type="button"
                  onClick={submit}
                  disabled={!prompt.trim() || loading}
                  data-testid="button-send-ask-lumen"
                  className="absolute right-2 bottom-2 p-1.5 rounded bg-teal text-black hover:bg-teal/80 disabled:opacity-30 transition-colors"
                  aria-label="Send"
                >
                  <Send size={12} />
                </button>
              </div>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
