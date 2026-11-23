/**
 * Settings › Agentes (MCP) (.specs/features/cerebro-perguntar, S7; design.md "Aba - Agentes (MCP) das Configurações"):
 * from `GET /api/mcp`, whether Claude Code, Cursor and Codex have MordomoOS's MCP server and the command that connects
 * each ("Conectar"), the 13 tools by kind ("Ferramentas") and what the agents read most. A chunk of its own, fetched
 * the first time the tab opens; while it loads, the settings skeleton, and when it fails, the settings error line.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Bot,
  Check,
  CircleCheck,
  CircleDashed,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Inbox,
  KeyRound,
} from "lucide-react";
import type { ApiCallResult } from "@mordomo/contracts";
import { useLang, useLocale, useT, type TKey } from "../../i18n";
import { qk, useApiQuery, useRouteQuery } from "../../queries";
import { Skeleton, timeAgo } from "../../components/ui";
import { Button } from "../../components/primitives";
import { copyText } from "../shared";
import "./agentsMcp.css";

export type McpOverview = ApiCallResult<"GET /api/mcp">;
type McpClient = McpOverview["clients"][number];

const KINDS = { read: Eye, propose: Inbox, owner: KeyRound };

export default function AgentsMcpTab() {
  const t = useT();
  const mcp = useRouteQuery(qk.mcp, "GET /api/mcp");
  // `<home>/memory/`, to show a read path relative to it (the identity tab's cache entry)
  const info = useApiQuery<{ home: string }>(["system", "info"], "/api/system/info", { staleTime: 60_000 });
  if (mcp.isPending) return <Skeleton lines={8} />;
  if (!mcp.data)
    return (
      <div className="error-box am-row" role="alert">
        {t("mcp.error")}
        <Button size="sm" onClick={() => void mcp.refetch()}>
          {t("mcp.retry")}
        </Button>
      </div>
    );
  return <AgentsMcp data={mcp.data} root={info.data && `${info.data.home.replace(/\/+$/, "")}/memory/`} />;
}

/** The three cards, in the design's order. */
export function AgentsMcp({ data, root }: { data: McpOverview; root?: string }) {
  const t = useT();
  return (
    <div className="am">
      <section className="card stack">
        <p className="am-s">{t("mcp.intro")}</p>
        {data.clients.map((c) => (
          <Client key={c.id} c={c} />
        ))}
        <p className="am-s">{t("mcp.reopen")}</p>
      </section>
      <section className="card stack">
        <p className="am-s am-row">
          <EyeOff aria-hidden />
          {t("mcp.toolsLine")}
        </p>
        <ul className="am-list">
          {data.tools.map(({ name, kind }) => {
            const Icon = KINDS[kind];
            return (
              <li key={name} className="am-row">
                <code>{name}</code>
                <span className="am-s am-grow">{t(`mcp.tool.${name}` as TKey)}</span>
                <span className="am-row" title={kind === "propose" ? t("mcp.toInbox") : undefined}>
                  <Icon aria-hidden />
                  {t(`mcp.kind.${kind}` as TKey)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <Usage usage={data.usage} root={root} />
    </div>
  );
}

function Client({ c }: { c: McpClient }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="am-col">
      <div className="am-row">
        <b className="am-grow">{c.name}</b>
        {c.connected ? (
          <span className="am-row am-ok">
            <CircleCheck aria-hidden />
            {t("mcp.on")}
          </span>
        ) : (
          <span className="am-row am-muted">
            <CircleDashed aria-hidden />
            {t("mcp.off")}
          </span>
        )}
      </div>
      {c.connected ? (
        <span className="mono">{c.source}</span>
      ) : (
        <>
          {c.unreadable && <p className="am-s">{t("mcp.unreadable", { file: c.source ?? "" })}</p>}
          {c.pasteInto && <p className="am-s">{t("mcp.paste", { file: c.pasteInto })}</p>}
          <pre className="am-pre">{c.command}</pre>
          <div>
            <Button
              size="sm"
              icon={copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              onClick={() =>
                void copyText(c.command).then((ok) => {
                  if (!ok) return;
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                })
              }
            >
              {t(copied ? "mcp.copied" : "mcp.copy")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** "O que os agentes mais leem": the empty state, or the reads by tool (bars), by program and the most read paths. */
export function Usage({ usage, root }: { usage: McpOverview["usage"]; root?: string }) {
  const t = useT();
  const lang = useLang();
  const locale = useLocale();
  const max = Math.max(1, ...usage.byTool.map((x) => x.calls));
  return (
    <section className="card stack">
      <h3>{t("mcp.usage")}</h3>
      {usage.calls === 0 ? (
        <p className="am-row">
          <Bot aria-hidden />
          {t("mcp.none")}
        </p>
      ) : (
        <>
          <p>
            {t("mcp.since", { n: usage.calls, date: new Date(usage.since ?? 0).toLocaleDateString(locale) })}
          </p>
          <h4>{t("mcp.byTool")}</h4>
          <ul className="am-list">
            {usage.byTool.map((x) => (
              <li key={x.name} className="am-bar">
                <code>{x.name}</code>
                <span className="am-track">
                  <span className="am-fill" style={{ transform: `scaleX(${x.calls / max})` }} />
                </span>
                {x.calls}
              </li>
            ))}
          </ul>
          <h4>{t("mcp.byClient")}</h4>
          <ul className="am-list">
            {usage.byClient.map((x) => (
              <li key={x.name} className="am-row">
                <span className="am-grow">
                  {x.name.startsWith("run:")
                    ? t("mcp.runs", { provider: x.name.charAt(4).toUpperCase() + x.name.slice(5) })
                    : x.name}
                </span>
                {x.calls}
                <span className="am-muted">{t("mcp.lastAt", { time: timeAgo(x.lastAt, lang) })}</span>
              </li>
            ))}
          </ul>
          <h4>{t("mcp.paths")}</h4>
          <ul className="am-list">
            {usage.paths.slice(0, 20).map((p) => {
              const line = (
                <>
                  <FileText aria-hidden />
                  {p.path.split(/[\\/]/).pop()}
                  <span className="am-s am-grow">
                    {root && p.path.startsWith(root) ? p.path.slice(root.length) : p.path}
                  </span>
                  {p.reads}
                </>
              );
              return (
                <li key={p.path}>
                  {p.fileId === undefined ? (
                    <span className="am-row">{line}</span>
                  ) : (
                    <Link className="am-row" to={`/brain?sel=${p.fileId}`}>
                      {line}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
