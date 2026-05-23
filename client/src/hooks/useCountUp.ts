import { useEffect, useRef, useState } from "react";

/**
 * Smoothly animate a number from 0 (or a previous value) up to `target`.
 * Uses requestAnimationFrame, eases out (cubic), respects prefers-reduced-motion.
 *
 * - First mount: counts up from 0 to target over `duration` ms.
 * - Subsequent target changes: counts from current displayed value to new
 *   target over `duration` ms (so live ticks don't restart from zero).
 */
export function useCountUp(target: number, duration = 1200): number {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const fromRef = useRef<number>(0);

  useEffect(() => {
    // Respect users with reduced motion preferences — show target instantly.
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(target);
      return;
    }

    if (!Number.isFinite(target)) {
      setDisplay(0);
      return;
    }

    fromRef.current = display;
    startTimeRef.current = null;

    const tick = (now: number) => {
      if (startTimeRef.current == null) startTimeRef.current = now;
      const elapsed = now - startTimeRef.current;
      const progress = Math.min(1, elapsed / duration);
      // Cubic ease-out — fast start, gentle finish.
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = fromRef.current + (target - fromRef.current) * eased;
      setDisplay(value);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return display;
}
