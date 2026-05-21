import { ReactNode } from "react";
import { Link } from "wouter";
import { ArrowUpRight } from "lucide-react";

interface Props {
  eyebrow: string;
  title: string;
  description?: string;
  href?: string;
  hrefLabel?: string;
  children?: ReactNode;
}

export function SectionHeader({ eyebrow, title, description, href, hrefLabel = "Open", children }: Props) {
  return (
    <header className="mb-5">
      <div className="flex items-end justify-between gap-6">
        <div>
          <div className="eyebrow mb-2">{eyebrow}</div>
          <h2 className="font-display text-[1.875rem] leading-[1.05] tracking-tight">{title}</h2>
          {description && (
            <p className="mt-2 text-sm text-muted-foreground max-w-xl leading-relaxed">{description}</p>
          )}
        </div>
        {href && (
          <Link href={href} data-testid={`link-section-${eyebrow.toLowerCase().replace(/\s+/g, "-")}`}>
            <div className="group inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
              {hrefLabel}
              <ArrowUpRight size={13} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </div>
          </Link>
        )}
        {children}
      </div>
    </header>
  );
}
