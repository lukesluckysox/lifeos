import { useAuth } from "@/components/AuthProvider";
import { Wordmark } from "@/components/Logo";

type CardDef = {
  domain: string;
  icon: React.ReactNode;
  eyebrow: string;
  description: string;
  bg: string;
  border: string;
  accent: string;
};

const CARDS: CardDef[] = [
  {
    domain: "Finance",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
        <polyline points="16 7 22 7 22 13" />
      </svg>
    ),
    eyebrow: "Portfolio",
    description: "Your portfolio across every account, in one canvas.",
    bg: "from-teal/10 to-teal/5",
    border: "border-teal/30",
    accent: "text-teal",
  },
  {
    domain: "Music",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    ),
    eyebrow: "Listening",
    description: "Your taste in full — recent plays, top tracks, new releases.",
    bg: "from-purple-500/10 to-purple-500/5",
    border: "border-purple-500/30",
    accent: "text-purple-400",
  },
  {
    domain: "Places",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    ),
    eyebrow: "City guide",
    description: "Restaurants, neighborhoods, and what's on near you.",
    bg: "from-amber-500/10 to-amber-500/5",
    border: "border-amber-500/30",
    accent: "text-amber-400",
  },
  {
    domain: "Events",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
    eyebrow: "Live events",
    description: "Concerts, arts, sports — matched to your artists and city.",
    bg: "from-rose-500/10 to-rose-500/5",
    border: "border-rose-500/30",
    accent: "text-rose-400",
  },
  {
    domain: "Watch",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    ),
    eyebrow: "Watch & film",
    description: "Rate, save, and discover what to watch next.",
    bg: "from-blue-500/10 to-blue-500/5",
    border: "border-blue-500/30",
    accent: "text-blue-400",
  },
];

// Geometric fan: each card sits in its own slot. 5 cards × 180px = 900px,
// but with rotation the visual width compresses, so 165px steps give
// a clean fan with subtle overlap (~15px) — readable but still feels like a deck.
const CARD_LAYOUT = [
  { rotate: -10, translateX: -330, translateY: 32, z: 1 },
  { rotate: -5,  translateX: -165, translateY: 10, z: 2 },
  { rotate: 0,   translateX: 0,    translateY: 0,  z: 5 }, // center, on top
  { rotate: 5,   translateX: 165,  translateY: 10, z: 3 },
  { rotate: 10,  translateX: 330,  translateY: 32, z: 1 },
];

export default function Landing() {
  const { login } = useAuth();

  // Demo mode is signalled via the URL hash query string — no storage,
  // matches the rest of the app's hash-routing convention.
  const handleDemoMode = () => {
    window.location.hash = "#/?demo=1";
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

      {/* Card deck — fanned out so each card sits in its own slot */}
      <div
        className="relative w-full max-w-[1000px] h-[280px] sm:h-[300px] mb-14 flex items-center justify-center"
        aria-label="Feature domains: Finance, Music, Places, Events, Watch"
        data-testid="card-deck"
      >
        <style>{`
          .landing-deck-card { transition: transform 500ms ease-out, box-shadow 500ms ease-out, z-index 0s; }
          .landing-deck-card:hover {
            transform: translate(var(--tx), calc(var(--ty) - 18px)) rotate(0deg) scale(1.04) !important;
            z-index: 50 !important;
            box-shadow: 0 16px 48px -12px rgba(0,0,0,0.55) !important;
          }
        `}</style>
        {CARDS.map((card, i) => {
          const layout = CARD_LAYOUT[i];
          return (
            <div
              key={card.domain}
              data-testid={`card-domain-${card.domain.toLowerCase()}`}
              className={`
                landing-deck-card group absolute w-[180px] sm:w-[200px] h-[210px] sm:h-[230px] rounded-2xl border
                bg-gradient-to-br ${card.bg} ${card.border}
                backdrop-blur-md p-5 flex flex-col gap-2
                shadow-[0_8px_32px_-8px_rgba(0,0,0,0.4)]
              `}
              style={{
                ['--tx' as string]: `${layout.translateX}px`,
                ['--ty' as string]: `${layout.translateY}px`,
                ['--rot' as string]: `${layout.rotate}deg`,
                ['--z' as string]: `${layout.z}`,
                transform: `translate(${layout.translateX}px, ${layout.translateY}px) rotate(${layout.rotate}deg)`,
                zIndex: layout.z,
              }}
            >
              <span className={`${card.accent}`}>{card.icon}</span>
              <div className="mt-1">
                <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{card.eyebrow}</div>
                <div className="font-display text-base text-foreground leading-tight mt-0.5">{card.domain}</div>
              </div>
              <p className="text-[11.5px] text-muted-foreground leading-snug mt-auto">{card.description}</p>
            </div>
          );
        })}
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
