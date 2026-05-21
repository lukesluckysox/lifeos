interface LogoProps {
  className?: string;
  size?: number;
}

export function Logo({ className, size = 22 }: LogoProps) {
  // Two interlocked arcs — taste meets memory. The dot is the present moment.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      className={className}
      aria-label="Life OS"
    >
      <path d="M4 12a8 8 0 0 1 8-8" />
      <path d="M20 12a8 8 0 0 1-8 8" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <Logo size={20} className="text-teal" />
      <div className="flex items-baseline gap-[0.4em]">
        <span className="font-display text-[1.15rem] leading-none tracking-tight text-foreground">
          Life
        </span>
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.22em] text-muted-foreground">
          OS
        </span>
      </div>
    </div>
  );
}
