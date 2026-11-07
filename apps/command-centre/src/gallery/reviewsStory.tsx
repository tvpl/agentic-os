/**
 * "Revisões" in the gallery (.specs/features/cerebro-natureza, C91): the six nature badges, the scope badges, a list
 * item, the three action rows of the detail and the "Virou realidade" dialog, from fixture data (the gallery never talks
 * to the API). Fetched when the gallery opens, through the screen's own chunk. `MemoriaReviewsStory` is the "Do
 * agente" half of the trustworthy-memory entry (cerebro-memoria-confiavel, C108): a list item of each kind of
 * proposal, an op row of each trust and each state, and the detail's two refusal banners.
 */
import { useState } from "react";
import { BecameFactDialog } from "../brain/reviews/BecameFactDialog";
import {
  AgentListItem,
  Detail,
  OpRow,
  RefusalBanner,
  ReviewListItem,
  type ReviewItem,
} from "../brain/reviews/ReviewsScreen";
import type { OpView, ProposalItem } from "../brain/reviews/AgentTab";
import { ESCOPOS, NATUREZAS, NatureBadge, ScopeBadge } from "../brain/natureza";

const ROOT = "/fixture/memory/notes";
const item = (name: string, over: Partial<ReviewItem>): ReviewItem => ({
  path: `${ROOT}/${name}`,
  name,
  natureza: null,
  type: null,
  escopo: null,
  lastReviewed: "2026-05-02",
  dueSince: "2026-08-31",
  editable: true,
  mtime: Date.UTC(2026, 3, 2),
  ...over,
});
const ROWS: ReviewItem[] = [
  item("lancamento.md", { natureza: "plano", escopo: "equipe" }),
  item("opiniao-precos.md", { natureza: "opiniao" }),
  item("relatorio.pdf.md", { natureza: "fato", editable: false, path: "/fixture/work/relatorio.md" }),
];
const none = () => undefined;

function NaturezaStory() {
  const [dialog, setDialog] = useState(false);
  return (
    <div className="rv">
      <div className="nb-filters">
        {[...NATUREZAS, null].map((n) => (
          <NatureBadge key={n ?? "none"} n={n} />
        ))}
        {ESCOPOS.map((s) => (
          <ScopeBadge key={s} s={s} />
        ))}
      </div>
      <ul className="rv-list">
        <ReviewListItem
          item={ROWS[0]!}
          selected
          path="memory/notes/lancamento.md"
          age="revisado há 4 meses"
          onSelect={none}
        />
      </ul>
      {ROWS.map((r) => (
        <Detail
          key={r.path}
          item={r}
          kind="due"
          content={`Notas de **${r.name}**.`}
          snoozeOpen={false}
          onSnoozeOpen={none}
          onDecide={none}
          onFact={() => setDialog(true)}
        />
      ))}
      {dialog && <BecameFactDialog onCancel={() => setDialog(false)} onConfirm={() => Promise.resolve()} />}
    </div>
  );
}

const AGENT_NOW = Date.UTC(2026, 8, 2, 14, 30);
const MEMORY = "/fixture/memory";
const proposal = (kind: ProposalItem["kind"], summary: string, author = "mcp"): ProposalItem => ({
  id: `mp_${kind}`,
  kind,
  status: "pending",
  author,
  runId: null,
  createdAt: AGENT_NOW - 7_200_000,
  summary,
  opCount: kind === "consolidation" ? 3 : 1,
});
const PROPOSALS = [
  proposal("consolidation", "", "run:a1b2c3"),
  proposal("memory_edit", "", "run:a1b2c3"),
  proposal("fact", "Cliente X · status"),
  proposal("note_create", "Reunião"),
  proposal("note_save", "cliente.md"),
];
const agentOp = (trust: OpView["trust"], state: OpView["state"] = "valid", reason?: string): OpView => ({
  op: "add",
  section: "Decisions",
  text: "Use SQLite for the history",
  source: "journal/2026-09-03.md",
  line: 12,
  trust,
  state,
  ...(reason ? { reason } : {}),
});
const OPS = [
  agentOp("usuario"),
  agentOp("ferramenta"),
  agentOp("inferido"),
  agentOp("inferido", "invalid", "journal/2099-01-01.md does not exist"),
  agentOp("inferido", "conflict", "the line is not in MEMORY.md"),
];
const ignore = () => undefined;

function MemoriaReviewsStory() {
  return (
    <div className="rv">
      <ul className="rv-list">
        {PROPOSALS.map((p, i) => (
          <AgentListItem key={p.id} item={p} selected={i === 0} onSelect={ignore} />
        ))}
      </ul>
      <ul className="ag-ops">
        {OPS.map((o, i) => (
          <OpRow
            key={i}
            op={o}
            ticked={o.state === "valid" && o.trust === "usuario"}
            onTick={ignore}
            memoryRoot={MEMORY}
          />
        ))}
      </ul>
      <RefusalBanner refusal={{ code: "edit_conflict", message: "" }} onReload={ignore} />
      <RefusalBanner refusal={{ code: "memory_over_budget", message: "" }} />
    </div>
  );
}

/** `part="memoria"`: the trustworthy-memory entry's half that lives in this module (and so in this chunk). */
export default function ReviewsStory({ part }: { part?: "memoria" }) {
  return part === "memoria" ? <MemoriaReviewsStory /> : <NaturezaStory />;
}
