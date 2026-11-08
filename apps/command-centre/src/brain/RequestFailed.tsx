import { CircleAlert } from "lucide-react";
import { Button } from "../components/primitives";
import { useT } from "../i18n";
import "./requestFailed.css";

/**
 * A request of the brain screens that failed, said as text beside an icon (never by colour alone) with a way to ask
 * again: the search hits and the related files of the Núcleo scene (.specs/features/cerebro-correcoes, S4).
 */
export function RequestFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="brain-request-failed" role="alert">
      <span className="brain-request-failed-text">
        <CircleAlert aria-hidden size={14} />
        {message}
      </span>
      <Button size="sm" variant="secondary" onClick={onRetry}>
        {t("brain.links.retry")}
      </Button>
    </div>
  );
}
