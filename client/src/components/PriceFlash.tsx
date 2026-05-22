import { useEffect, useRef, useState, ReactNode } from "react";

/**
 * Wraps a numeric display and briefly flashes teal (up) or rose (down)
 * when its `value` changes. Use for prices, daily change %, etc.
 *
 * Example:
 *   <PriceFlash value={netWorth}>${netWorth.toFixed(2)}</PriceFlash>
 */
export function PriceFlash({
  value,
  children,
  className = "",
  testId,
}: {
  value: number;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const prevRef = useRef<number>(value);
  const [direction, setDirection] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (Number.isFinite(value) && Number.isFinite(prev) && value !== prev) {
      setDirection(value > prev ? "up" : "down");
      const id = setTimeout(() => setDirection(null), 900);
      prevRef.current = value;
      return () => clearTimeout(id);
    }
    prevRef.current = value;
  }, [value]);

  const flashClass =
    direction === "up"
      ? "bg-teal/15 text-teal"
      : direction === "down"
      ? "bg-rose/15 text-rose"
      : "";

  return (
    <span
      data-testid={testId}
      className={`transition-colors duration-700 rounded px-0.5 ${flashClass} ${className}`}
    >
      {children}
    </span>
  );
}
