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
  const { loginWithSpotify, loginWithGoogle } = useAuth();

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
      <div className="text-center mb-14 space-y-3 max-w-md">
        <h1 className="font-display text-xl tracking-tight text-foreground leading-tight">
          Your money, your music, your places — in one place.
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          A quiet personal dashboard. Live portfolio from your brokerages, recent listens from Spotify, the places you've saved. One sign-in. No ads.
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

      {/* Sign-in options */}
      <div className="flex flex-col items-stretch gap-3 w-full max-w-[280px]">
        <button
          type="button"
          data-testid="button-login-google"
          onClick={loginWithGoogle}
          className="
            group relative inline-flex items-center justify-center gap-3
            px-6 py-3 rounded-full
            bg-foreground text-background font-display text-sm tracking-wide
            hover:bg-foreground/90 active:scale-[0.98]
            transition-all duration-200
          "
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#EA4335" d="M9 3.48c1.69 0 2.83.73 3.48 1.34l2.54-2.48C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.91 2.26C4.6 5.05 6.62 3.48 9 3.48z"/>
            <path fill="#4285F4" d="M17.64 9.2c0-.74-.06-1.28-.19-1.84H9v3.34h4.96c-.1.83-.64 2.08-1.84 2.92l2.84 2.2c1.7-1.57 2.68-3.88 2.68-6.62z"/>
            <path fill="#FBBC05" d="M3.88 10.78A5.54 5.54 0 0 1 3.58 9c0-.62.11-1.22.29-1.78L.96 4.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l2.92-2.26z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.84-2.2c-.76.53-1.78.9-3.12.9-2.38 0-4.4-1.57-5.12-3.74L.97 13.04C2.45 15.98 5.48 18 9 18z"/>
          </svg>
          Continue with Google
        </button>

        <button
          type="button"
          data-testid="button-login-spotify"
          onClick={loginWithSpotify}
          className="
            group relative inline-flex items-center justify-center gap-3
            px-6 py-3 rounded-full
            bg-teal text-background font-display text-sm tracking-wide
            hover:bg-teal/90 active:scale-[0.98]
            transition-all duration-200
            shadow-[0_0_24px_0_rgba(0,188,188,0.2)]
          "
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.5 17.3a.75.75 0 0 1-1.03.25c-2.82-1.72-6.37-2.11-10.55-1.16a.75.75 0 1 1-.33-1.46c4.57-1.04 8.5-.59 11.66 1.34.36.22.47.69.25 1.03zm1.47-3.27a.94.94 0 0 1-1.29.31c-3.23-1.99-8.16-2.56-11.98-1.4a.94.94 0 1 1-.55-1.8c4.37-1.33 9.8-.69 13.51 1.6.44.27.58.85.31 1.29zm.13-3.4c-3.87-2.3-10.27-2.51-13.97-1.39a1.13 1.13 0 1 1-.66-2.16c4.25-1.29 11.31-1.04 15.77 1.6a1.13 1.13 0 1 1-1.14 1.95z"/>
          </svg>
          Continue with Spotify
        </button>
      </div>

      {/* Sub-text */}
      <div className="mt-5 text-center space-y-2">
        <p className="text-[11px] text-muted-foreground/60">
          Read-only access · we don't sell your data · delete anytime
        </p>
        <button
          type="button"
          data-testid="button-demo-mode"
          onClick={handleDemoMode}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
        >
          Try the demo first →
        </button>
      </div>

      {/* Trust strip */}
      <div className="mt-12 max-w-2xl w-full">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
          {[
            { eyebrow: "Banking", title: "Plaid read-only", body: "Your broker login never touches our server." },
            { eyebrow: "Data", title: "Yours alone", body: "No ads. No reselling. No analytics on your behavior." },
            { eyebrow: "Quit anytime", title: "Delete it all", body: "One click wipes your account and every byte we store." },
          ].map((t) => (
            <div key={t.title} className="rounded-lg border border-border/60 bg-card/30 p-4">
              <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground mb-1">{t.eyebrow}</div>
              <div className="font-display text-xs text-foreground mb-1">{t.title}</div>
              <div className="text-[11px] text-muted-foreground leading-snug">{t.body}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-10 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/50">
        Radius · v0.4 · made in Hawaii
      </div>
    </div>
  );
}
