/**
 * A document window (redesign F5): a file the agent produced, or one the user
 * opened from search, living on the stage as a window like any other.
 *
 * This is what makes a reference mean something. A widget is UI — asking the
 * agent about "@pulse" would be asking about a chart. A document has a path,
 * so `@plan.md` resolves to a file the agent can actually read, and the thing
 * you are looking at is the thing you are talking about.
 */
import { useEffect, useState } from "react";
import { ExternalLink, MessageCircleQuestion } from "lucide-react";
import { api, artifactRawUrl, isRawViewable, type MemoryPreview } from "../api";
import { useT } from "../i18n";
import { WidgetGate } from "./widgets/WidgetGate";
import { docPath } from "./docIds";
import { useDesktopActions } from "./actions";
import { getPanels } from "./panelKinds";
import { askAgent } from "../nucleo/subject";
import type { WidgetProps } from "./widgetTypes";

const PREVIEW_LINES = 400;
const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v)$/i;

export default function DocWindow({ instanceId }: WidgetProps) {
  const t = useT();
  const actions = useDesktopActions();
  const path = instanceId ? docPath(instanceId) : "";
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pictures and videos are shown, not read.
  const media = IMAGE.test(path) ? "image" : VIDEO.test(path) ? "video" : null;
  useEffect(() => {
    let alive = true;
    setText(null);
    setError(null);
    if (!path || media) return;
    api
      .get<MemoryPreview>(`/api/memory/preview?p=${encodeURIComponent(path)}`)
      .then((res) => {
        if (!alive) return;
        if (res.kind === "text" && res.content)
          setText(res.content.split(/\r?\n/).slice(0, PREVIEW_LINES).join("\n"));
        else setText("");
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [path, media]);

  const file = path.split(/[\\/]/).pop() ?? path;
  const viewable = isRawViewable(file);

  return (
    <div className="doc-window">
      <WidgetGate queries={[]} lines={3}>
        {media === "image" ? (
          <img className="doc-media" src={artifactRawUrl(path)} alt={path.split(/[\\/]/).pop() ?? path} />
        ) : media === "video" ? (
          <video className="doc-media" src={artifactRawUrl(path)} controls aria-label={path}>
            <track kind="captions" />
          </video>
        ) : error ? (
          <p role="status" className="dim">
            {error}
          </p>
        ) : text === null ? (
          <p className="dim">{t("common.loading")}</p>
        ) : text === "" ? (
          <p className="dim">{t("desktop.doc.noPreview")}</p>
        ) : (
          <pre className="doc-body">{text}</pre>
        )}
      </WidgetGate>
      <div className="doc-foot">
        <button
          type="button"
          className="btn sm primary"
          onClick={() => {
            // The lâmina is already referenceable: the line opens with its @name.
            const panel = getPanels().find((p) => p.id === instanceId);
            if (panel) askAgent(`@${panel.ref} `);
          }}
        >
          <MessageCircleQuestion aria-hidden /> {t("concept.runs.ask")}
        </button>
        <button
          type="button"
          className="btn sm ghost"
          onClick={() => actions.referencePanel(instanceId ?? "")}
          title={t("desktop.doc.reference")}
        >
          @ {t("desktop.doc.reference")}
        </button>
        {viewable && (
          <a
            className="btn sm ghost"
            href={artifactRawUrl(path)}
            target="_blank"
            rel="noreferrer"
            title={t("desktop.doc.open")}
          >
            <ExternalLink aria-hidden /> {t("desktop.doc.open")}
          </a>
        )}
        <span className="doc-path mono" title={path}>
          {path}
        </span>
      </div>
    </div>
  );
}
