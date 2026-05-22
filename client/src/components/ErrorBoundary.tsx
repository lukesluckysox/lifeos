import { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface State {
  hasError: boolean;
  error: Error | null;
}

interface Props {
  children: ReactNode;
  /** Label shown in the fallback UI, e.g. "Finance page" */
  label?: string;
}

/**
 * Catches render-phase errors in its subtree and renders a graceful
 * fallback. Without this, a single `undefined.toFixed()` (or any
 * thrown error during render) unmounts the entire React tree and
 * leaves the user staring at a blank background div.
 *
 * Wrap each top-level page in one of these.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[error-boundary]", this.props.label || "subtree", error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-[60vh] flex items-center justify-center p-8" data-testid="error-boundary-fallback">
        <div className="max-w-md w-full rounded-lg border border-rose/30 bg-rose/5 p-6 space-y-4">
          <div className="flex items-center gap-2 text-rose">
            <AlertTriangle size={18} />
            <span className="font-display text-base">Something broke here</span>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The {this.props.label || "page"} crashed while rendering. The rest of
            the app is still working — try refreshing or going back home.
          </p>
          {this.state.error && (
            <pre className="text-[10px] font-mono text-muted-foreground/70 bg-background/60 p-2 rounded border border-border overflow-x-auto whitespace-pre-wrap break-all">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={this.handleReset}
              data-testid="button-error-retry"
              className="inline-flex items-center gap-1.5 rounded-md bg-teal/15 border border-teal/30 text-teal px-3 py-1.5 text-xs font-medium hover:bg-teal/25 transition-colors"
            >
              <RefreshCw size={12} />
              Try again
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              data-testid="button-error-reload"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
