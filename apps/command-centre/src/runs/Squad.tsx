/**
 * Squad (plan Onda 3 §5): the children a run fanned out, and a form to fan
 * out more. Each child is an ordinary prompt run with `parentRunId`; the
 * tree here is one level deep on purpose — a child can open its own page
 * and fan out again.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GitFork, Plus } from "lucide-react";
import { api, type RunRecord } from "../api";
import { useT } from "../i18n";
import { qk, useApiQuery } from "../queries";
import { Button } from "../components/primitives";
import { StatusBadge, formatDuration, useToast } from "../components/ui";

export function SquadCard({ run }: { run: RunRecord }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const children = useApiQuery<RunRecord[]>(
    qk.runChildren(run.id),
    `/api/runs/${encodeURIComponent(run.id)}/children`,
    {
      refetchInterval: (q) =>
        (q.state.data ?? []).some((r) => r.status === "running" || r.status === "queued") ? 30_000 : false,
    },
  );
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"read_only" | "write">("read_only");
  const fanOut = useMutation({
    mutationFn: (prompts: string[]) =>
      api.post<{ runs: Array<{ runId: string | null; status: string }> }>(
        `/api/runs/${encodeURIComponent(run.id)}/children`,
        { prompts, mode },
      ),
    onSuccess: (res) => {
      setText("");
      setOpen(false);
      qc.invalidateQueries({ queryKey: qk.runChildren(run.id) }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
      const parked = res.runs.filter((r) => r.status === "waiting_approval").length;
      toast(
        parked > 0 ? t("runs.squad.parked", { n: parked }) : t("runs.squad.started", { n: res.runs.length }),
        parked > 0 ? "info" : "ok",
      );
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const prompts = text
    .split(/\n{2,}|\n(?=\s*[-*]\s)/)
    .map((p) => p.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
  const list = children.data ?? [];
  if (list.length === 0 && !open) {
    return (
      <div className="card squad">
        <div className="card-head-row">
          <h2>{t("runs.squad.title")}</h2>
          <Button size="sm" variant="outline" icon={<GitFork aria-hidden />} onClick={() => setOpen(true)}>
            {t("runs.squad.fanOut")}
          </Button>
        </div>
        <p className="hint">{t("runs.squad.hint")}</p>
      </div>
    );
  }
  return (
    <div className="card squad">
      <div className="card-head-row">
        <h2>
          {t("runs.squad.title")}
          {list.length > 0 && <span className="badge">{list.length}</span>}
        </h2>
        {!open && (
          <Button size="sm" variant="outline" icon={<Plus aria-hidden />} onClick={() => setOpen(true)}>
            {t("runs.squad.fanOut")}
          </Button>
        )}
      </div>
      {list.length > 0 && (
        <ul className="plain-list squad-list">
          {list.map((c) => (
            <li key={c.id}>
              <StatusBadge status={c.status} />
              <Link to={`/runs/${c.id}`} className="truncate plain">
                {c.promptSummary}
              </Link>
              <span className="meta mono">
                {c.durationMs != null ? formatDuration(c.durationMs) : ""}
                {typeof c.usage?.costUsd === "number" && c.usage.costUsd > 0
                  ? ` · $${c.usage.costUsd.toFixed(3)}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="squad-form">
          <textarea
            className="input"
            rows={4}
            value={text}
            placeholder={t("runs.squad.placeholder")}
            aria-label={t("runs.squad.fanOut")}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="squad-form-row">
            <label className="hud-label">
              <input
                type="checkbox"
                checked={mode === "write"}
                onChange={(e) => setMode(e.target.checked ? "write" : "read_only")}
              />{" "}
              {t("runs.squad.write")}
            </label>
            <span className="hint">{t("runs.squad.count", { n: prompts.length })}</span>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={prompts.length === 0}
              loading={fanOut.isPending}
              onClick={() => fanOut.mutate(prompts)}
            >
              {t("runs.squad.launch")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
