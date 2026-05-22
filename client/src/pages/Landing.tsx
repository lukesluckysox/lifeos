import { useAuth } from "@/components/AuthProvider";
import { Wordmark } from "@/components/Logo";

const CARDS = [
  {
    domain: "Finance",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
        <polyline points="16 7 22 7 22 13" />
      </svg>
    ),
    eyebrow: "Portfolio",
    description: "Your portfolio across every account, in one canvas.",
    color: "from-teal/10 to-teal/5",
    border: "border-teal/25",
    accent: "text-teal",
    rotation: "rotate-[-6deg]",
    offset: "translate-y-[24px] translate-x-[-8px]",
  },
  {
    domain: "Music",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    ),
    eyebrow: "Listening",
    description: "Your taste in full — recent plays, top tracks, new releases.",
    color: "from-purple-500/10 to-purple-500/5",
    border: "border-purple-500/25",
    accent: "text-purple-400",
    rotation: "rotate-[-3deg]",
    offset: "translate-y-[12px] translate-x-[-4px]",
  },
  {
    domain: "Places",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    ),
    eyebrow: "City guide",
    description: "Restaurants, neighborhoods, and what's on near you.",
    color: "from-amber-500/10 to-amber-500/5",
    border: "border-amber-500/25",
    accent: "text-amber-400",
    rotation: "rotate-[0deg]",
    offset: "translate-y-0",
  },
  {
    domain: "Events",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
    eyebrow: "Live events",
    description: "Concerts, arts, sports — matched to your artists and city.",
    color: "from-rose-500/10 to-rose-500/5",
    border: "border-rose-500/25",
    accent: "text-rose-400",
    rotation: "rotate-[3deg]",
    offset: "translate-y-[12px] translate-x-[4px]",
  },
  {
    domain: "Watch",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    ),
    eyebrow: "Watch & film",
    description: "Rate, save, and discover what to watch next.",
    color: "from-blue-500/10 to-blue-500/5",
    border: "border-blue-500/25",
    accent: "text-blue-400",
    rotation: "rotate-[6deg]",
    offset: "translate-y-[24px] translate-x-[8px]",
  },
];

export default function Landing() {
  const { login } = useAuth();

  const handleDemoMode = () => {
    // Set demo mode in sessionStorage and redirect to app
    sessionStorage.setItem("lifeOsDemoMode", "demo");
    window.location.hash = "#/";
    // Force a reload to pick up the hash change
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-6 py-16 select-none overflow-hidden">
      {/* Wordmark */}
      <div className="mb-16">
        <Wordmark />
      </div>

      {/* Tagline */}
      <div className="text-center mb-14 space-y-2">
        <h1 className="font-display text-xl tracking-tight text-foreground leading-tight">
          Everything that makes you, you.
        </h1>
        <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
          Finance, music, places, events, and film — in one quiet, personal OS.
        </p>
      </div>

      {/* Card deck */}
      <div
        className="relative w-[280px] h-[200px] mb-16"
        aria-label="Feature domains: Finance, Music, Places, Events, Watch"
        data-testid="card-deck"
      >
        {CARDS.map((card, i) => (
          <div
            key={card.domain}
            className={`
              absolute inset-0 rounded-2xl border bg-gradient-to-br ${card.color} ${card.border}
              backdrop-blur-sm p-6 flex flex-col gap-3
              transition-transform duration-300
              ${card.rotation} ${card.offset}
            `}
            style={{ zIndex: i }}
          >
            <div className="flex items-center gap-3">
              <span className={card.accent}>{card.icon}</span>
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{card.eyebrow}</div>
                <div className="font-display text-base text-foreground leading-tight">{card.domain}</div>
              </div>
            </div>
            <p className="text-[13px] text-muted-foreground leading-relaxed">{card.description}</p>
          </div>
        ))}
      </div>

      {/* Enter button */}
      <button
        type="button"
        data-testid="button-enter"
        onClick={login}
        className="
          group relative px-10 py-3.5 rounded-full
          bg-teal text-background font-display text-base tracking-wide
          hover:bg-teal/90 active:scale-[0.98]
          transition-all duration-200
          shadow-[0_0_32px_0_rgba(0,188,188,0.25)]
          hover:shadow-[0_0_48px_0_rgba(0,188,188,0.35)]
        "
      >
        ENTER
      </button>

      {/* Sub-text */}
      <div className="mt-6 text-center space-y-2">
        <p className="text-xs text-muted-foreground/70">
          Continue with Spotify · email read-only
        </p>
        <button
          type="button"
          data-testid="button-demo-mode"
          onClick={handleDemoMode}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
        >
          Try demo mode
        </button>
      </div>
    </div>
  );
}
