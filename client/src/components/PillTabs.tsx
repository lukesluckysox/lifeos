import { ReactNode } from "react";

export type PillTab<T extends string> = {
  id: T;
  label: string;
  icon?: ReactNode;
};

export function PillTabs<T extends string>({
  tabs,
  value,
  onChange,
  testIdPrefix = "tab",
}: {
  tabs: PillTab<T>[];
  value: T;
  onChange: (id: T) => void;
  testIdPrefix?: string;
}) {
  return (
    <div className="inline-flex gap-1 rounded-md border border-border p-0.5 bg-secondary/40" role="tablist">
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={active}
            data-testid={`${testIdPrefix}-${t.id}`}
            onClick={() => onChange(t.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider rounded transition-colors ${
              active
                ? "bg-teal text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
