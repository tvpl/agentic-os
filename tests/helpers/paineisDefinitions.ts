/**
 * The definitions of .specs/features/cerebro-paineis C5: one that every rule of door 1 accepts, each refusal made on it
 * alone (L-039) with the path its one issue names, and the edges door 1 accepts. Shared by the validator's own layer
 * (`paineis.layer.test.ts`) and the route (`paineis.routes.test.ts`).
 */

type Json = Record<string, any>;

/** A definition every rule accepts: one widget of each family the cases touch. */
export function valid(): Json {
  return {
    v: 1,
    title: "Teste",
    kind: "overview",
    refresh: "15m",
    widgets: [
      {
        id: "k",
        kind: "kpi",
        title: "Abertas",
        source: { kind: "tasks", window: "today" },
        options: { measure: "open" },
      },
      {
        id: "n",
        kind: "list",
        title: "Notas",
        source: { kind: "notes", type: ["decision"] },
        options: { limit: 8 },
      },
      { id: "m", kind: "kpi", title: "Execuções", source: { kind: "metrics", series: "runs24h" } },
      {
        id: "c",
        kind: "agenda",
        title: "Agenda",
        source: { kind: "connector", id: "calendar-google", read: "list" },
      },
    ],
  };
}
export const widget = (i: number): Json => ({
  id: `w${i}`,
  kind: "list",
  title: `W ${i}`,
  source: { kind: "runs" },
});
export const bytesOf = (def: unknown) => Buffer.byteLength(`${JSON.stringify(def, null, 2)}\n`);

/** `valid()` grown to exactly `size` bytes as stored, by the tags of one more notes widget. */
export function sized(size: number): Json {
  const def = valid();
  const pad: Json = {
    id: "pad",
    kind: "list",
    title: "Pad",
    source: { kind: "notes", tags: [] as string[] },
  };
  def.widgets.push(pad);
  const tags = pad.source.tags as string[];
  while (bytesOf(def) < size) tags.push("t".repeat(200));
  tags.pop();
  // Grow the last tag one character at a time (each adds one byte), taking a new one when it is full.
  tags.push("t");
  while (bytesOf(def) < size) {
    if (tags[tags.length - 1]!.length === 200) tags.push("t");
    else tags[tags.length - 1] += "t";
  }
  if (bytesOf(def) !== size) throw new Error(`could not size the definition at ${size}`);
  return def;
}

/** Door 1's refusals, each on a definition every other rule accepts (L-039), and the path its one issue names. */
export const REFUSALS: Array<[string, (d: Json) => void, Array<string | number>]> = [
  ["an unknown top-level key", (d) => (d.owner = "x"), []],
  ["an unknown widget key", (d) => (d.widgets[0].color = "red"), ["widgets", 0]],
  ["13 widgets", (d) => (d.widgets = Array.from({ length: 13 }, (_, i) => widget(i))), ["widgets"]],
  ["a widget kind pie", (d) => (d.widgets[1].kind = "pie"), ["widgets", 1, "kind"]],
  ["a source kind files", (d) => (d.widgets[1].source = { kind: "files" }), ["widgets", 1, "source", "kind"]],
  ["refresh 30m", (d) => (d.refresh = "30m"), ["refresh"]],
  ["refresh daily@24:00", (d) => (d.refresh = "daily@24:00"), ["refresh"]],
  ["refresh daily@7:30", (d) => (d.refresh = "daily@7:30"), ["refresh"]],
  ["a definition of 65 537 bytes", (d) => Object.assign(d, sized(65_537)), []],
  ["two widgets with one id", (d) => (d.widgets[1].id = "k"), ["widgets", 1, "id"]],
  [
    "a question dashboard with refresh 15m",
    (d) => Object.assign(d, { kind: "question", question: "Por quê?", widgets: [] }),
    ["refresh"],
  ],
  ["a notes source with the key owner", (d) => (d.widgets[1].source.owner = "eu"), ["widgets", 1, "source"]],
  [
    "a tasks source with window month",
    (d) => (d.widgets[0].source.window = "month"),
    ["widgets", 0, "source", "window"],
  ],
  ["options.limit 51", (d) => (d.widgets[1].options.limit = 51), ["widgets", 1, "options", "limit"]],
  ["options.limit 0", (d) => (d.widgets[1].options.limit = 0), ["widgets", 1, "options", "limit"]],
  [
    "options.measure done_of_due on a notes source",
    (d) => Object.assign(d.widgets[1], { kind: "kpi", options: { measure: "done_of_due" } }),
    ["widgets", 1, "options", "measure"],
  ],
  [
    "a metrics source with series costToday",
    (d) => (d.widgets[2].source.series = "costToday"),
    ["widgets", 2, "source", "series"],
  ],
  [
    "a connector source with key and read list",
    (d) => (d.widgets[3].source.key = "unread"),
    ["widgets", 3, "source", "key"],
  ],
  ["a title of 121 characters", (d) => (d.title = "t".repeat(121)), ["title"]],
];

export const ACCEPTED: Array<[string, (d: Json) => void]> = [
  ["exactly 12 widgets", (d) => (d.widgets = Array.from({ length: 12 }, (_, i) => widget(i)))],
  ["refresh daily@00:00", (d) => (d.refresh = "daily@00:00")],
  ["refresh daily@23:59", (d) => (d.refresh = "daily@23:59")],
  ["options.limit 50", (d) => (d.widgets[1].options.limit = 50)],
  ["a definition of exactly 65 536 bytes", (d) => Object.assign(d, sized(65_536))],
];
