import { useLookback } from "@/components/LookbackContext";

export function LookbackPills() {
  const { weeks, setWeeks, options } = useLookback();

  return (
    <div className="flex items-center gap-1" data-testid="lookback-pills">
      {options.map((opt) => {
        const active = opt.weeks === weeks;
        return (
          <button
            key={opt.testId}
            data-testid={opt.testId}
            onClick={() => setWeeks(opt.weeks)}
            className={[
              "text-[11px] font-mono px-2 py-0.5 rounded-full border transition-colors",
              active
                ? "bg-teal text-background border-teal"
                : "bg-secondary/40 text-muted-foreground border-transparent hover:text-foreground",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
