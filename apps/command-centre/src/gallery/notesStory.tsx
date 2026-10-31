/**
 * The notes view in the gallery (.specs/features/cerebro-vista-notas, C78): the tree with a folder open and a lock, the
 * tabs with one holding unsaved changes, and a note with its properties table and the five callouts of a note's
 * nature, from fixture data seeded in the cache (the gallery never talks to the API). Fetched when the gallery opens,
 * with the view's chunk. `MemoriaHistoryStory` is the history half of the trustworthy-memory entry
 * (cerebro-memoria-confiavel, C108): a history row, which opens the version dialog on a version seeded in the cache.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
// Through the view's own module: the gallery and the app fetch one chunk of the notes view, not two halves of it.
import { HistoryRow, NoteReader, NoteTabs, NotesTree } from "../brain/notes/NotesView";
import VersionDialog, { type VersionRef } from "../brain/notes/VersionDialog";
import type { NoteDoc, NoteLinks, TreeLevel } from "../brain/notes/notesData";
import type { NotesState } from "../brain/notes/useNotesState";

const ROOT = "/fixture/memory";
const NOTE = `${ROOT}/notes/plano.md`;
const OTHER = `${ROOT}/notes/agenda.md`;
const HEAD = "---\ntype: projeto\nstatus: active\ntags: [fixture, demo]\nnatureza: plano\n---\n";
const BODY = [
  "# Plano de exemplo",
  "Um texto de fixture, com [[Agenda]].",
  "> [!fato] A sede fica na rua A.",
  "> [!opiniao] O plano é bom.",
  "> [!plano] Abrir em março.",
  "> [!hipotese] O preço cai.",
  "> [!relato] Ana contou ontem.",
].join("\n\n");

const row = (id: number, rel: string, title: string, over: Partial<TreeLevel["files"][number]> = {}) => ({
  id,
  rel,
  name: rel.slice(rel.lastIndexOf("/") + 1),
  title,
  type: null,
  mtime: 1,
  editable: true,
  ...over,
});
const level = (dir: string, over: Partial<TreeLevel>): TreeLevel => ({
  roots: [{ path: ROOT, name: "memory", editable: true, indexing: false }],
  root: ROOT,
  dir,
  folders: [],
  files: [],
  indexNote: null,
  truncated: false,
  omitted: 0,
  ...over,
});
const TOP = level("", {
  folders: [
    { rel: "notes", name: "notes", count: 2, editable: true },
    { rel: "journal", name: "journal", count: 4, editable: false, reason: "generated" },
  ],
  files: [row(3, "ROUTER.md", "Router", { editable: false, reason: "generated" })],
});
const NOTES = level("notes", {
  files: [row(2, "notes/agenda.md", "Agenda"), row(1, "notes/plano.md", "Plano")],
});
const DOC: NoteDoc = {
  path: NOTE,
  name: "plano.md",
  version: "sha256:fixture",
  size: HEAD.length + BODY.length,
  mtime: 1,
  content: HEAD + BODY,
  editable: true,
  properties: [
    { key: "type", kind: "text", value: "projeto" },
    { key: "status", kind: "status", value: "active" },
    { key: "tags", kind: "list", value: ["fixture", "demo"] },
    { key: "natureza", kind: "select", value: "plano" },
  ],
  otherProperties: null,
  bodyStart: HEAD.length,
};
const LINKS = {
  backlinks: [],
  outgoing: [{ kind: "wikilink", target: "agenda", label: null, line: 3, resolved: null, alternatives: [] }],
} as unknown as NoteLinks;

const none = () => undefined;
const STATE = {
  tabs: { tabs: [NOTE, OTHER], active: NOTE, focusedAt: {} },
  unsaved: new Set([OTHER]),
  meta: new Map([
    [NOTE, { id: 1, title: "Plano" }],
    [OTHER, { id: 2, title: "Agenda" }],
  ]),
  focus: none,
  close: none,
  open: () => true,
} as unknown as NotesState;

function NotesViewStory() {
  const qc = useQueryClient();
  // The answers the components would ask for, in the cache before they mount.
  useState(() => {
    qc.setQueryData(["memory", "tree", { root: ROOT, dir: "notes" }], NOTES);
    qc.setQueryData(["memory", "note", NOTE], DOC);
    qc.setQueryData(["memory", "links", 1], LINKS);
    return null;
  });
  return (
    <div className="story-notes">
      <NotesTree
        root={ROOT}
        sort="name"
        top={TOP}
        expanded={new Set([`${ROOT}/notes`])}
        setExpanded={none}
        selected={NOTE}
        onOpenFile={none}
        onSelectFolder={none}
      />
      <NoteTabs state={STATE} value={NOTE}>
        <NoteReader
          path={NOTE}
          id={1}
          meta={{ id: 1, title: "Plano" }}
          onOpen={none}
          onShowInGraph={none}
          onSetHome={none}
        />
      </NoteTabs>
    </div>
  );
}

const VERSION: VersionRef = {
  id: 1,
  at: Date.UTC(2026, 8, 2, 11, 30),
  author: "owner",
  origin: "save",
  sha256: "sha256:old",
};

function MemoriaHistoryStory() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  useState(() =>
    qc.setQueryData(["memory", "history", "version", VERSION.id], {
      ...VERSION,
      path: "notes/a.md",
      content: "",
      diff: "@@ -1,2 +1,2 @@\n # A\n-April\n+March\n",
      current: "sha256:now",
    }),
  );
  return (
    <>
      <ul className="hf-list">
        <HistoryRow version={VERSION} current={false} onOpen={() => setOpen(true)} />
      </ul>
      {open && (
        <VersionDialog version={VERSION} onClose={() => setOpen(false)} onRestored={() => undefined} />
      )}
    </>
  );
}

/** `part="memoria"`: the trustworthy-memory entry's half that lives in this module (and so in this chunk). */
export default function NotesStory({ part }: { part?: "memoria" }) {
  return part === "memoria" ? <MemoriaHistoryStory /> : <NotesViewStory />;
}
