import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Sparkles, Search, LineChart, Music, MapPin, ArrowRight, X } from "lucide-react";

/**
 * First-visit onboarding tour. Shows a single full-screen welcome card with
 * 3 short steps the user can click through, then marks onboarding_completed=1
 * in the DB so it never shows again for this user.
 *
 * - Skipped entirely if the user isn't signed in.
 * - Skipped if onboardingCompleted is already true.
 */

interface MeResp {
  user: null | {
    id: number;
    displayName?: string;
    onboardingCompleted?: boolean;
  };
}

const STEPS = [
  {
    icon: Sparkles,
    title: "Welcome to your life-os",
    body: "Lumen tracks the things you care about — your money, your music, the places you go — in one quiet space. No ads, no noise.",
  },
  {
    icon: Search,
    title: "⌘K opens anything",
    body: "Hit Cmd+K (or Ctrl+K) anywhere to jump between pages, add a holding, scan your watchlist, or ask the assistant.",
  },
  {
    icon: LineChart,
    title: "Connect once, watch it work",
    body: "Link a brokerage with Plaid for live portfolio data. Connect Spotify for music recommendations. Or stay in demo mode — both feel real.",
  },
];

export function OnboardingTour() {
  const { data: me } = useQuery<MeResp>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => (await apiRequest("GET", "/api/auth/me")).json(),
  });

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Open when we've confirmed a signed-in user who hasn't completed onboarding
  useEffect(() => {
    if (me?.user && !me.user.onboardingCompleted) {
      // Small delay to let the page settle first
      const id = setTimeout(() => setOpen(true), 500);
      return () => clearTimeout(id);
    }
  }, [me?.user?.id, me?.user?.onboardingCompleted]);

  const complete = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/auth/onboarding-completed")).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setOpen(false);
    },
  });

  if (!open || !me?.user) return null;

  const Step = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const Icon = Step.icon;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-md flex items-center justify-center px-6 animate-fade-in"
      data-testid="onboarding-tour"
    >
      <div className="relative w-full max-w-md rounded-lg border border-border bg-card p-8 shadow-2xl animate-rise-in">
        <button
          type="button"
          onClick={() => complete.mutate()}
          aria-label="Skip tour"
          data-testid="button-skip-onboarding"
          className="absolute top-3 right-3 p-1.5 rounded hover:bg-accent/60 text-muted-foreground"
        >
          <X size={14} />
        </button>

        {/* Step icon */}
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-teal/10 text-teal mb-5">
          <Icon size={22} />
        </div>

        <h2 className="font-display text-xl mb-3" data-testid="text-onboarding-title">
          {Step.title}
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-6">
          {Step.body}
        </p>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-1.5 mb-6">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all ${
                i === step ? "w-6 bg-teal" : "w-1.5 bg-muted-foreground/30"
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => complete.mutate()}
            disabled={complete.isPending}
            data-testid="button-skip-tour"
            className="text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => {
              if (isLast) complete.mutate();
              else setStep(s => s + 1);
            }}
            disabled={complete.isPending}
            data-testid="button-next-onboarding"
            className="flex items-center gap-2 rounded bg-teal text-black px-4 py-2 text-xs font-mono uppercase tracking-wider hover:bg-teal/80 transition-colors disabled:opacity-50"
          >
            {isLast ? "Let's go" : "Next"}
            <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Reusable empty-state component. Pages can drop this in where they don't
 * yet have data to show.
 */
export function EmptyState({
  icon: Icon = Sparkles,
  title,
  body,
  ctaLabel,
  onCta,
  testId,
}: {
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  body: string;
  ctaLabel?: string;
  onCta?: () => void;
  testId?: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center py-12 px-6 rounded-lg border border-dashed border-border bg-card/30"
      data-testid={testId}
    >
      <div className="flex items-center justify-center w-12 h-12 rounded-full bg-teal/10 text-teal mb-4">
        <Icon size={20} />
      </div>
      <h3 className="font-display text-base mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-5">{body}</p>
      {ctaLabel && onCta && (
        <button
          type="button"
          onClick={onCta}
          className="rounded bg-teal text-black px-4 py-2 text-xs font-mono uppercase tracking-wider hover:bg-teal/80 transition-colors"
        >
          {ctaLabel}
        </button>
      )}
    </div>
  );
}

// Re-export helpers for other pages to use
export { LineChart as FinanceIcon, Music as MusicIcon, MapPin as PlacesIcon };
