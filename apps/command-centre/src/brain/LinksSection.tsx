/**
 * Who points at a note, and which of its own links lead nowhere (.specs/features/cerebro-v2, design.md "Tela - Links no
 * preview"). Read from `GET /api/memory/links`, which resolves the links when asked: a file created, renamed or deleted
 * changes the answer on the next index pass without any other note being rewritten.
 */
import { Unlink } from "lucide-react";
import { Button } from "../components/primitives";
import { useT } from "../i18n";
import { useRouteQuery } from "../queries";

export interface LinksSectionProps {
  /** The index id of the file (the id of its graph node). */
  fileId: number;
  onSelectId: (id: number, focus?: boolean) => void;
}

export function LinksSection({ fileId, onSelectId }: LinksSectionProps) {
  const t = useT();
  const links = useRouteQuery(["memory", "links", fileId], "GET /api/memory/links", {
    query: { id: fileId },
  });

  if (links.isPending) {
    return (
      <section className="brain-links" aria-label={t("brain.links")}>
        <p className="brain-links-state">
          <span className="spinner" aria-hidden /> {t("common.loading")}
        </p>
      </section>
    );
  }
  if (links.isError) {
    return (
      <section className="brain-links" aria-label={t("brain.links")}>
        <p className="brain-links-state" role="alert">
          {links.error.message}
        </p>
        <Button size="sm" variant="secondary" onClick={() => void links.refetch()}>
          {t("brain.links.retry")}
        </Button>
      </section>
    );
  }

  const { backlinks, outgoing } = links.data;
  const broken = outgoing.filter((link) => link.resolved === null);
  return (
    <section className="brain-links" aria-label={t("brain.links")}>
      <div className="hud-label">{`${t("brain.links.backlinks")} (${backlinks.length})`}</div>
      {backlinks.length === 0 ? (
        <p className="brain-links-state">{t("brain.links.none")}</p>
      ) : (
        <ul className="brain-links-list">
          {backlinks.map((link, i) => (
            <li key={`${link.file.id}-${link.line}-${i}`}>
              <button type="button" className="brain-md-link" onClick={() => onSelectId(link.file.id, true)}>
                {link.file.title ?? link.file.name}
              </button>
              <span className="brain-links-meta">{t("brain.links.line", { n: link.line })}</span>
            </li>
          ))}
        </ul>
      )}
      {broken.length > 0 && (
        <>
          <div className="hud-label">{`${t("brain.links.broken")} (${broken.length})`}</div>
          <ul className="brain-links-list broken">
            {broken.map((link, i) => (
              <li key={`${link.kind}-${link.target}-${link.line}-${i}`}>
                <Unlink aria-hidden />
                <span className="mono">{link.label ?? shortTarget(link.target)}</span>
                <span className="brain-links-meta">{t("brain.links.line", { n: link.line })}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** What a broken link names, without the folders it was resolved under. */
function shortTarget(target: string): string {
  return target.slice(Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\")) + 1);
}
