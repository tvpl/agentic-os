/**
 * The Brain scene's content icons (immersive shell): what kind of thing a
 * note is — a plain note, a daily journal, an index, code, an image, a PDF,
 * data, a web clip, a person, a project, a task list, a meeting… — inferred
 * from what the graph already carries (extension, folders, frontmatter
 * fields, tags, title), and one vector glyph per kind.
 *
 * The glyphs are SVG path data on a 24×24 grid, drawn as 1.6-wide strokes:
 * the sky strokes them with `Path2D` (crisp at any zoom), the reader and the
 * legend with `<path>`. Pure.
 */

export type ContentKind =
  | "note"
  | "journal"
  | "index"
  | "project"
  | "person"
  | "meeting"
  | "tasks"
  | "web"
  | "code"
  | "data"
  | "config"
  | "image"
  | "pdf"
  | "doc"
  | "file";

/** Display order (legend, the "types" dimension): writing first, then the rest. */
export const CONTENT_KINDS: readonly ContentKind[] = [
  "note",
  "journal",
  "index",
  "project",
  "person",
  "meeting",
  "tasks",
  "web",
  "doc",
  "pdf",
  "image",
  "data",
  "code",
  "config",
  "file",
];

const PAGE = "M6 3h8l4 4v14H6z M14 3v4h4";

/** 24×24 stroke paths (round caps and joins). */
export const GLYPHS: Record<ContentKind, string> = {
  note: `${PAGE} M9 12h6 M9 15.5h6 M9 8.5h2.5`,
  journal: "M4 5.5h16V20H4z M4 10h16 M8.5 3v4.5 M15.5 3v4.5 M8 13.5h3v3H8z",
  index:
    "M12 9.6a2.4 2.4 0 1 1 0 4.8a2.4 2.4 0 1 1 0-4.8z M12 9.6V5.4 M12 14.4v4.2 M9.6 12H5.4 M14.4 12h4.2 M12 2.4a1.5 1.5 0 1 1 0 3a1.5 1.5 0 1 1 0-3z M12 18.6a1.5 1.5 0 1 1 0 3a1.5 1.5 0 1 1 0-3z M3.9 10.5a1.5 1.5 0 1 1 0 3a1.5 1.5 0 1 1 0-3z M20.1 10.5a1.5 1.5 0 1 1 0 3a1.5 1.5 0 1 1 0-3z",
  project:
    "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z M12 7.5a4.5 4.5 0 1 1 0 9a4.5 4.5 0 1 1 0-9z M12 11a1 1 0 1 1 0 2a1 1 0 1 1 0-2z",
  person: "M12 4a3.6 3.6 0 1 1 0 7.2a3.6 3.6 0 1 1 0-7.2z M5 20.5c.9-3.9 3.6-6.3 7-6.3s6.1 2.4 7 6.3",
  meeting: "M3.5 5h11v8H9l-3 3v-3H3.5z M17.5 9h3v8h-2v3l-3-3h-4.5v-2",
  tasks: "M3.5 6.5l2 2 3.5-3.5 M3.5 13.5l2 2 3.5-3.5 M12.5 7h8 M12.5 14h8 M4.5 20h3.5 M12.5 20h8",
  web: "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z M3 12h18 M12 3c2.9 3.2 2.9 14.8 0 18 M12 3c-2.9 3.2-2.9 14.8 0 18",
  code: "M8 7l-5 5 5 5 M16 7l5 5-5 5 M13.6 4.5l-3.2 15",
  data: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  config: "M4 6h9 M17 6h3 M15 4v4 M4 12h3 M11 12h9 M9 10v4 M4 18h11 M19 18h1 M17 16v4",
  image: "M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6 M16 7.5a1.6 1.6 0 1 1 0 3.2a1.6 1.6 0 1 1 0-3.2z",
  pdf: `${PAGE} M9 18v-7h2.6a1.9 1.9 0 0 1 0 3.8H9`,
  doc: `${PAGE} M8.5 11l1.3 6 1.7-4.2 1.7 4.2 1.3-6`,
  file: `${PAGE} M9 14h6`,
};

const EXT_KIND: Record<string, ContentKind> = {};
const put = (kind: ContentKind, exts: string) => {
  for (const e of exts.split(" ")) EXT_KIND[`.${e}`] = kind;
};
put("image", "png jpg jpeg gif webp svg heic heif avif bmp ico tif tiff");
put("pdf", "pdf");
put("doc", "doc docx odt rtf pages ppt pptx key odp epub");
put("data", "csv tsv json jsonl ndjson xls xlsx ods parquet sqlite db numbers geojson");
put("config", "yaml yml toml ini env conf cfg plist lock properties");
put(
  "code",
  "ts tsx js jsx mjs cjs py rb go rs java kt kts swift c h cc cpp hpp cs php sh zsh bash fish ps1 sql css scss sass less vue svelte lua r scala dart ex exs erl hs ml clj el vim zig nim",
);
put("web", "url webloc html htm mhtml");
put("file", "mp3 mp4 m4a mov wav flac ogg webm zip gz tar 7z dmg bin exe");
const TEXT_EXT = new Set([
  ".md",
  ".markdown",
  ".mdx",
  ".mdown",
  ".txt",
  ".org",
  ".rst",
  ".adoc",
  ".text",
  "",
]);

/** Folder / field / tag words → kind. Portuguese and English, singular and plural. */
const WORDS: Array<[ContentKind, RegExp]> = [
  ["journal", /^(journals?|daily|dailies|diary|diario|diário|log|logs|dia|dias|days?)$/],
  ["person", /^(people|persons?|contacts?|pessoas?|contatos?|contactos?|crm|who)$/],
  ["meeting", /^(meetings?|reunio(es|ões)|reuni(ao|ão)|atas?|calls?|1on1s?|1-1s?|standups?|retros?)$/],
  ["project", /^(projects?|projetos?|proyectos?|initiatives?|iniciativas?)$/],
  ["tasks", /^(tasks?|todos?|to-?dos?|tarefas?|backlog|checklists?|kanban)$/],
  [
    "web",
    /^(clips?|clippings?|web|bookmarks?|articles?|artigos?|readings?|leituras?|links?|highlights?|recortes?|read-?later)$/,
  ],
  ["index", /^(index|indexes|indices|mocs?|maps?|hubs?|routers?|indice|índice|mapas?|areas|áreas)$/],
];

function wordKind(word: string): ContentKind | null {
  const w = word.trim().toLowerCase().replace(/^#/, "");
  if (!w) return null;
  for (const [kind, re] of WORDS) if (re.test(w)) return kind;
  return null;
}

export interface KindInput {
  name: string;
  rel: string;
  ext: string;
  title: string | null;
  tags?: readonly string[];
  fields?: Readonly<Record<string, string>>;
}

const FIELD_KEYS = ["type", "kind", "category", "tipo", "categoria", "class"];

/**
 * The kind of a note. First what the author declared (a `type:` field, a
 * tag), then what the file is (its extension), then where it lives (a
 * `journal/` or `people/` folder), then how it is named (a date, "Index",
 * "Meeting", "TODO"). Plain text falls back to a note, anything else to a file.
 */
export function inferKind(n: KindInput): ContentKind {
  const ext = n.ext.toLowerCase();
  const byExt = EXT_KIND[ext];
  // Binary and structured formats are what they are, whatever the folder.
  if (byExt && byExt !== "web") return byExt;
  const fields = n.fields ?? {};
  for (const key of FIELD_KEYS) {
    const v = fields[key];
    if (v) {
      const k = wordKind(v) ?? (/^(notes?|nota)$/i.test(v.trim()) ? "note" : null);
      if (k) return k;
    }
  }
  const url = fields.url ?? fields.source ?? fields.link ?? "";
  if (/^https?:\/\//i.test(url.trim())) return "web";
  for (const tag of n.tags ?? []) {
    const k = wordKind(tag.split("/")[0] ?? tag);
    if (k) return k;
  }
  if (byExt) return byExt;
  const segs = n.rel.replace(/\\/g, "/").split("/").slice(0, -1);
  for (let i = segs.length - 1; i >= 0; i--) {
    const k = wordKind(segs[i]!);
    if (k) return k;
  }
  const base = n.name.replace(/\.[^.]+$/, "");
  const title = (n.title ?? "").toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}/.test(base) || /^\d{4}-\d{2}-\d{2}\b/.test(title)) return "journal";
  if (
    /^(readme|index|_index|router|moc|home|start|toc|summary)$/i.test(base) ||
    /\b(index|router|moc|map of content|índice|indice|sumário)\b/i.test(title)
  )
    return "index";
  if (/\b(meeting|reuni[aã]o|1:1|one-on-one|standup|retro|kickoff|sync)\b/i.test(title)) return "meeting";
  if (/\b(todo|to-do|tasks|tarefas|checklist|backlog)\b/i.test(title) || /^todos?$/i.test(base))
    return "tasks";
  if (/\b(project|projeto|roadmap)\b/i.test(title)) return "project";
  return TEXT_EXT.has(ext) ? "note" : "file";
}
