import { ThumbsUp, ThumbsDown, Bookmark, Heart, Loader2 } from "lucide-react";
import { useRatings, useSetRating, useRemoveRating, ratingIndex, type RatingKind, type Signal } from "@/hooks/useRatings";

interface Props {
  kind: RatingKind;
  externalId: string;
  title: string;
  meta?: Record<string, any>;
  compact?: boolean;
}

const SIGNALS: { value: Signal; icon: any; label: string; tint: string }[] = [
  { value: -1, icon: ThumbsDown, label: "Not for me", tint: "text-rose" },
  { value: 0, icon: Bookmark, label: "Watchlist", tint: "text-muted-foreground" },
  { value: 1, icon: ThumbsUp, label: "Like", tint: "text-teal" },
  { value: 2, icon: Heart, label: "Love", tint: "text-gold" },
];

export function RatingBar({ kind, externalId, title, meta, compact }: Props) {
  const { data: ratings } = useRatings();
  const setMut = useSetRating();
  const removeMut = useRemoveRating();

  const idx = ratingIndex(ratings);
  const current = idx.get(`${kind}:${externalId}`);
  const busy = setMut.isPending || removeMut.isPending;

  const onClick = (sig: Signal) => {
    if (current?.signal === sig) {
      removeMut.mutate({ kind, externalId });
    } else {
      setMut.mutate({ kind, externalId, title, signal: sig, meta });
    }
  };

  return (
    <div className="flex items-center gap-1" data-testid={`rating-${kind}-${externalId}`}>
      {SIGNALS.map((s) => {
        const active = current?.signal === s.value;
        const Icon = s.icon;
        return (
          <button
            key={s.value}
            data-testid={`button-rate-${s.value}-${externalId}`}
            disabled={busy}
            onClick={() => onClick(s.value)}
            aria-label={s.label}
            title={s.label}
            className={`h-7 w-7 grid place-items-center rounded-md border transition-colors ${
              active
                ? `border-current ${s.tint} bg-secondary/40`
                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
            } ${compact ? "h-6 w-6" : ""}`}
          >
            {busy && active ? <Loader2 size={12} className="animate-spin" /> : <Icon size={compact ? 11 : 13} strokeWidth={1.6} />}
          </button>
        );
      })}
    </div>
  );
}
