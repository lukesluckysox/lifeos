import { useScope } from "./ScopeProvider";

interface LogoProps {
  className?: string;
  size?: number;
}

/**
 * LifeOS mark — a quarter-arc sweeping from a center point.
 * The center dot is the user. The arc is the range of what they care about
 * (finance, music, places). A single mark, geometric, works at 16px.
 */
export function Logo({ className, size = 22 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label="LifeOS"
    >
      {/* The arc — a sweep from due-right to due-top (a 90° radius) */}
      <path d="M20 12 A8 8 0 0 0 12 4" />
      {/* The radius line connecting center to the arc start */}
      <path d="M12 12 L20 12" opacity="0.45" />
      {/* The center — the user */}
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Full wordmark — logo + "LifeOS" set in display type. Used in the
 * landing page hero, the sign-in screen, and the sidebar.
 *
 * When the household Shared scope is active, the subtitle line swaps to
 * "together" regardless of `showTagline` — a quiet, always-on signal
 * that you're looking at the combined view, not just your own.
 * ScopeProvider wraps the whole app (including the pre-auth Landing
 * page), so `useScope()` is always safe to call here.
 */
export function Wordmark({ className, showTagline = false }: { className?: string; showTagline?: boolean }) {
  const { scope } = useScope();
  const shared = scope === "shared";

  return (
    <div className={`flex items-center gap-2.5 ${className ?? ""}`}>
      <Logo size={22} className="text-teal" />
      <div className="flex flex-col leading-none">
        <span className="font-display text-[1.15rem] leading-none tracking-tight text-foreground">
          LifeOS
        </span>
        {shared ? (
          <span
            className="font-mono text-[0.55rem] uppercase tracking-[0.22em] text-teal mt-1"
            data-testid="text-wordmark-together"
          >
            together
          </span>
        ) : showTagline ? (
          <span className="font-mono text-[0.55rem] uppercase tracking-[0.22em] text-muted-foreground mt-1">
            life · in one place
          </span>
        ) : null}
      </div>
    </div>
  );
}
