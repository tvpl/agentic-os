import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { useT } from "../i18n";
import { Button } from "./primitives";

interface Props {
  children: ReactNode;
  /** Human name of the surface, shown in the message (e.g. the app name). */
  name?: string;
  /** When this value changes (e.g. the route), the boundary resets itself. */
  resetKey?: unknown;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

/** Per-route error boundary with a retry button (audit item 16). */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", this.props.name ?? "", error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.reset();
  }

  reset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return <ErrorFallback error={this.state.error} name={this.props.name} onRetry={this.reset} />;
  }
}

function ErrorFallback({ error, name, onRetry }: { error: Error; name?: string; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="error-boundary" role="alert">
      <div className="card">
        <h3>{t("error.title")}</h3>
        <p style={{ color: "var(--text-dim)" }}>{t("error.body", { name: name ?? t("os.agenticOs") })}</p>
        <details>
          <summary className="hud-label" style={{ cursor: "pointer" }}>
            {t("error.details")}
          </summary>
          <pre>
            {error.message}
            {error.stack ? `\n${error.stack}` : ""}
          </pre>
        </details>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => window.location.reload()}>
            {t("error.reload")}
          </Button>
          <Button variant="primary" icon={<RefreshCw aria-hidden />} onClick={onRetry}>
            {t("common.retry")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ErrorBoundary;
