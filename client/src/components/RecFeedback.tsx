import { useEffect, useState } from "react";
import { ThumbsUp, ThumbsDown, Bookmark } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type Kind = "music" | "finance" | "concert" | "food" | "film" | "show" | "place" | "event";

interface Props {
  kind: Kind;
  externalId: string;
  /** A short reason this rec exists (saved with thumb feedback). */
  reason?: string;
  /** Short pill shown left of the buttons explaining WHY this rec exists. e.g. "Because you like Burning Spear". */
  why?: string;
  /** Human-readable title for bookmarks. Falls back to `reason`, then externalId. */
  title?: string;
  /** Extra metadata to persist on the bookmark (artist, venue, date, etc.). */
  meta?: Record<string, unknown>;
  className?: string;
  compact?: boolean;
}

/**
 * Inline feedback row to attach to any recommendation card.
 * Optimistically updates local UI; persists to /api/rec-feedback and /api/bookmarks.
 */
export function RecFeedback({ kind, externalId, reason, why, title, meta, className, compact }: Props) {
  const [signal, setSignal] = useState<1 | -1 | 0>(0);
  const [bookmarked, setBookmarked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [bookmarking, setBookmarking] = useState(false);

  // Hydrate bookmark state from server on mount
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await apiRequest("GET", `/api/bookmarks?kind=${encodeURIComponent(kind)}`);
        const j = await r.json();
        if (cancel) return;
        const arr = Array.isArray(j?.bookmarks) ? j.bookmarks : [];
        if (arr.some((b: any) => b.externalId === externalId)) setBookmarked(true);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancel = true;
    };
  }, [kind, externalId]);

  async function send(s: 1 | -1) {
    if (submitting) return;
    const next = signal === s ? 0 : s;
    setSignal(next);
    setSubmitting(true);
    try {
      if (next === 0) {
        await apiRequest("DELETE", `/api/rec-feedback/${kind}/${encodeURIComponent(externalId)}`);
      } else {
        await apiRequest("POST", "/api/rec-feedback", { kind, externalId, signal: next, reason });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/rec-feedback"] });
    } catch (e) {
      // revert
      setSignal(signal);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleBookmark() {
    if (bookmarking) return;
    const next = !bookmarked;
    setBookmarked(next);
    setBookmarking(true);
    try {
      if (next) {
        await apiRequest("POST", "/api/bookmarks", {
          kind,
          externalId,
          title: title || reason || externalId,
          meta: meta || (reason ? { reason } : undefined),
        });
      } else {
        await apiRequest("DELETE", `/api/bookmarks/${kind}/${encodeURIComponent(externalId)}`);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/bookmarks"] });
    } catch {
      setBookmarked(!next);
    } finally {
      setBookmarking(false);
    }
  }

  return (
    <div className={cn("flex items-center gap-2 text-xs", className)}>
      {why && (
        <span
          className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground"
          title={why}
          data-testid={`chip-why-${kind}-${externalId}`}
        >
          why?
        </span>
      )}
      {why && !compact && (
        <span className="hidden sm:inline text-muted-foreground italic truncate max-w-[200px]" data-testid={`text-why-${kind}-${externalId}`}>
          {why}
        </span>
      )}
      <button
        type="button"
        onClick={() => send(1)}
        disabled={submitting}
        aria-label="Thumbs up"
        data-testid={`button-thumbs-up-${kind}-${externalId}`}
        className={cn(
          "inline-flex items-center justify-center rounded-full border border-border w-7 h-7 hover:bg-accent transition",
          signal === 1 && "bg-primary/10 border-primary text-primary"
        )}
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => send(-1)}
        disabled={submitting}
        aria-label="Thumbs down"
        data-testid={`button-thumbs-down-${kind}-${externalId}`}
        className={cn(
          "inline-flex items-center justify-center rounded-full border border-border w-7 h-7 hover:bg-accent transition",
          signal === -1 && "bg-destructive/10 border-destructive text-destructive"
        )}
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={toggleBookmark}
        disabled={bookmarking}
        aria-label={bookmarked ? "Remove bookmark" : "Bookmark"}
        title={bookmarked ? "Saved \u2014 click to remove" : "Save for later"}
        data-testid={`button-bookmark-${kind}-${externalId}`}
        className={cn(
          "inline-flex items-center justify-center rounded-full border border-border w-7 h-7 hover:bg-accent transition",
          bookmarked && "bg-gold/10 border-gold text-gold"
        )}
      >
        <Bookmark className={cn("h-3.5 w-3.5", bookmarked && "fill-current")} />
      </button>
    </div>
  );
}
