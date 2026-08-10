"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Shown instead of the default panel. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Identifies the failing area in the logged message. */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Stops one broken component from blanking the entire application.
 *
 * Without a boundary, any render-time exception unmounts the whole React tree
 * and the administrator is left staring at a white page with no way back.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept as console for now: there is no client log sink yet, and swallowing
    // it silently would make these failures invisible in production.
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`, error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center rounded-card border border-border bg-surface px-4 py-14 text-center shadow-card"
      >
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-warning-soft text-warning-strong dark:bg-warning-dark-soft dark:text-warning-dark-strong">
          <AlertTriangle size={22} />
        </div>
        <p className="text-sm font-medium text-text-primary">Cette section n'a pas pu être affichée</p>
        <p className="mt-1 max-w-md text-xs text-text-secondary">
          Le reste de l'application fonctionne normalement. Recharger cette section la rétablit généralement.
        </p>
        {process.env.NODE_ENV !== "production" && (
          <pre className="mt-4 max-w-full overflow-x-auto rounded-input bg-neutral-soft p-3 text-left text-[11px] text-text-secondary dark:bg-white/5">
            {error.message}
          </pre>
        )}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={this.reset} className="btn btn-secondary text-xs">
            <RefreshCw size={14} /> Recharger la section
          </button>
          <button type="button" onClick={() => (window.location.href = "/dashboard")} className="btn btn-primary text-xs">
            <Home size={14} /> Go to dashboard
          </button>
        </div>
      </div>
    );
  }
}
