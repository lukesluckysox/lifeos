import { Sparkles } from "lucide-react";

interface Props {
  learning?: { dropped?: number; boosted?: number; basis?: string[] | number } | null;
  className?: string;
}

/**
 * Small inline hint shown when the feed has been reranked based on
 * the user's 👍/👎 history. Stays silent when there's no signal.
 */
export function LearningHint({ learning, className }: Props) {
  if (!learning) return null;
  const boosted = learning.boosted || 0;
  const dropped = learning.dropped || 0;
  if (boosted === 0 && dropped === 0) return null;

  const parts: string[] = [];
  if (boosted > 0) parts.push(`${boosted} reordered`);
  if (dropped > 0) parts.push(`${dropped} hidden`);

  return (
    <div
      className={`inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground ${className ?? ""}`}
      data-testid="learning-hint"
      title={`Tuned to your thumbs \u2014 ${Array.isArray(learning.basis) && learning.basis.length ? `signals from: ${learning.basis.join(", ")}` : "based on your feedback so far"}.`}
    >
      <Sparkles size={11} className="text-gold" />
      <span>tuned to your thumbs &middot; {parts.join(" \u00b7 ")}</span>
    </div>
  );
}
