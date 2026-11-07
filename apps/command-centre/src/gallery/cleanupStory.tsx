/**
 * The guided cleanup in the gallery (.specs/features/cerebro-faxina-guiada, C81): the step bar, the inventory cards, a
 * finding card of each answer row (with "Juntar" and without it) and the review list, from fixture data (the gallery
 * never talks to the API). Fetched when the gallery opens, through the wizard's own chunk.
 */
import { FindingCard, InventoryCards, ReviewStep, StepBar } from "../brain/cleanup/CleanupWizard";
import type { Finding, Inventory } from "../brain/cleanup/cleanupData";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 2, 14, 30);
const ROOT = "/fixture/memory/notes";
const INVENTORY: Inventory = {
  scope: { kind: "dir", path: ROOT },
  total: { count: 48, bytes: 912_384 },
  byKind: (["notes", "text", "pdf", "image", "code", "other"] as const).map((kind, i) => ({
    kind,
    count: 31 - i * 5,
    bytes: 240_000 - i * 30_000,
  })),
  bySize: [],
  newest: NOW - 2 * DAY,
  byAge: [0, 31, 91, 366].map((from, i) => ({ from, to: [30, 90, 365, null][i]!, count: 12 + i })),
  topFolders: ["projetos", "clientes", "pesquisa"].map((name, i) => ({
    path: `${ROOT}/${name}`,
    count: 10 - i * 3,
    bytes: 400_000 - i * 120_000,
  })),
  clusters: ["projetos", "clientes"].map((name, i) => ({
    kind: "folder",
    name,
    path: null,
    count: 18 - i * 6,
    terms: [],
  })),
};
const file = (id: number, rel: string, age: number) => ({
  id,
  path: `${ROOT}/${rel}`,
  size: 2_048 * id,
  mtime: NOW - age * DAY,
  sha256: "0".repeat(64),
});
const NEAR: Finding = {
  key: "near-duplicate:1",
  kind: "near-duplicate",
  files: [file(1, "projetos/plano.md", 3), file(2, "projetos/plano-v2.md", 40)],
  detail: { similarity: 0.92 },
  suggested: "merge",
};
const STALE: Finding = {
  key: "stale:1",
  kind: "stale",
  files: [file(3, "pesquisa/antigo.md", 410)],
  detail: { since: "mtime", ageDays: 410 },
  suggested: "archive",
};
const none = () => undefined;

export default function CleanupStory() {
  return (
    <div className="cln-story">
      <StepBar step={3} />
      <InventoryCards data={INVENTORY} />
      <ul className="cln-cards">
        {[NEAR, STALE].map((f) => (
          <FindingCard
            key={f.key}
            finding={f}
            answer={undefined}
            busy={false}
            failed={false}
            onAnswer={none}
            onRetry={none}
          />
        ))}
      </ul>
      <ReviewStep
        plan={[
          {
            from: `${ROOT}/pesquisa/antigo.md`,
            to: "memory/archive/2026-09-02-…/notes/pesquisa/antigo.md",
            decision: "archive",
          },
          { from: "/fixture/work/relatorio.pdf", to: null, decision: "archive" },
        ]}
      />
    </div>
  );
}
