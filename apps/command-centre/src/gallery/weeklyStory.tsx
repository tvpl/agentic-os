/**
 * "Revisão semanal" in the gallery (.specs/features/cerebro-rituais, C99): the step bar, a loop item, a project item, a
 * locked project item (outside memory/), the archive list and a mention item of the note panel's fold, from fixture
 * data (the gallery never talks to the API). Fetched when the gallery opens, through the page's own chunk.
 */
import {
  ArchiveList,
  LoopItem,
  ProjectItem,
  StepBar,
  type Loop,
  type Project,
} from "../brain/weekly/WeeklyReview";
import { MentionItem, type Mention } from "../brain/notes/MentionsFold";

const ROOT = "/fixture/memory";
const none = () => undefined;
const item = {
  itemRef: none,
  selected: false,
  leaving: false,
  trouble: undefined,
  onReload: none,
  onPick: none,
};
const LOOP: Loop = {
  key: "a1",
  text: "Ligar para a Ana sobre o contrato",
  day: "2026-10-22",
  ageDays: 18,
  sources: [
    { path: `${ROOT}/journal/2026-10-22.md`, line: 4 },
    { path: `${ROOT}/journal/2026-10-29.md`, line: 7 },
    { path: `${ROOT}/MEMORY.md`, line: 12 },
  ],
} as Loop;
const project = (title: string, over: Partial<Project>): Project =>
  ({
    path: `${ROOT}/notes/${title.toLowerCase()}.md`,
    title,
    status: "active",
    due: null,
    health: "behind",
    nextAction: { text: "Mandar a proposta", line: 6 },
    lastReviewed: "2026-10-31",
    reviewBy: "2026-11-07",
    reviewDue: true,
    editable: true,
    version: "sha256:fixture",
    ...over,
  }) as Project;
const APP = project("App", {});
const ATA = project("Ata", {
  path: "/fixture/work/ata.md",
  editable: false,
  version: null,
  health: "on_track",
  reviewDue: false,
});
const ARCHIVE = [
  { path: `${ROOT}/notes/site-novo.md`, title: "Site novo", editable: true, doneSince: "2026-11-03" },
  { path: "/fixture/work/relatorio.md", title: "Relatório", editable: false, doneSince: "2026-11-02" },
];
const MENTION: Mention = {
  file: {
    id: 2,
    root: ROOT,
    path: `${ROOT}/notes/diario.md`,
    rel: "notes/diario.md",
    name: "diario.md",
    ext: ".md",
    dir: `${ROOT}/notes`,
    area: null,
    size: 40,
    mtime: Date.UTC(2026, 10, 9),
    indexedAt: Date.UTC(2026, 10, 9),
    title: null,
    tags: [],
    fields: {},
  },
  line: 5,
  excerpt: "Hoje o curso de marco atrasou de novo.",
  term: "Curso de Março",
  editable: true,
  version: "sha256:fixture",
} as Mention;

export default function WeeklyStory() {
  return (
    <div className="wk">
      <StepBar current={2} left={new Set([1])} onGo={none} />
      <ul className="wk-list">
        <LoopItem
          {...item}
          loop={LOOP}
          someday={false}
          making={false}
          projects={[APP]}
          onClose={none}
          onKeep={none}
          onSomeday={none}
          onKeepSomeday={none}
          onMake={none}
          onProject={none}
          onTask={none}
        />
        {[APP, ATA].map((p) => (
          <ProjectItem
            key={p.path}
            {...item}
            project={p}
            paused={false}
            reviewedToday={false}
            nextAction={p.nextAction?.text ?? null}
            onAdd={() => Promise.resolve(true)}
            onReviewed={none}
            onStatus={none}
          />
        ))}
      </ul>
      <ArchiveList
        items={ARCHIVE}
        unchecked={new Set()}
        rel={(p) => p.slice(ROOT.length + 1)}
        onToggle={none}
      />
      <ul className="mf-list">
        <MentionItem
          mention={MENTION}
          busy={false}
          trouble={undefined}
          onOpen={none}
          onLink={none}
          onReload={none}
        />
      </ul>
    </div>
  );
}
