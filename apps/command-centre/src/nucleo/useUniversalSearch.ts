/**
 * The one search (refino item 52), kept by the immersive shell: artifacts,
 * indexed files, runs, skills and notifications answer the same field,
 * grouped. ⌘F opens it from any scene.
 */
import { useEffect, useMemo, useState } from "react";
import type { MemorySearchHit } from "../api";
import { useApiQuery, useOsSkills } from "../queries";
import { useNotifications } from "../hooks/useNotifications";
import { useArtifactList, useDesktopRuns } from "../desktop/data";
import type { ArtifactHit } from "../desktop/ArtifactSearch";

const SEARCH_DEBOUNCE_MS = 220;

export function useUniversalSearch(searching: boolean) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query]);
  useEffect(() => {
    if (searching) return;
    setQuery("");
    setDebounced("");
  }, [searching]);
  const runs = useDesktopRuns();
  const notifications = useNotifications();
  const searchList = useArtifactList({ q: debounced, limit: 40 }, searching && debounced.trim().length >= 2);
  const fileHits = useApiQuery<MemorySearchHit[]>(
    ["memory", "search", debounced],
    `/api/memory/search?q=${encodeURIComponent(debounced)}&limit=8`,
    { enabled: searching && debounced.trim().length >= 2, retry: false },
  );
  const skillsForSearch = useOsSkills();
  const hits = useMemo<ArtifactHit[]>(() => {
    if (!searching) return [];
    const q = debounced.trim().toLowerCase();
    const out: ArtifactHit[] = (searchList.data?.items ?? []).slice(0, 8).map((item) => ({
      key: `a:${item.id || item.path}`,
      kind: "artifact" as const,
      label: item.file.split("/").pop() ?? item.file,
      title: item.title || item.file,
      path: item.path,
      runId: item.runId,
      skillSlug: item.skillSlug,
      ts: item.createdAt,
    }));
    for (const f of fileHits.data ?? [])
      out.push({
        key: `f:${f.id}`,
        kind: "file",
        label: f.name,
        title: f.name,
        path: f.path ?? f.rel,
        runId: null,
        skillSlug: null,
        ts: f.mtime ?? 0,
        nodeId: f.id,
      });
    if (q.length >= 2) {
      for (const r of (runs.data ?? [])
        .filter((r) => r.promptSummary.toLowerCase().includes(q) || (r.skillSlug ?? "").includes(q))
        .slice(0, 5))
        out.push({
          key: `r:${r.id}`,
          kind: "run",
          label: r.id.slice(0, 8),
          title: r.skillSlug ? `/${r.skillSlug}` : r.promptSummary.slice(0, 80),
          path: `${r.provider} · ${r.status}`,
          runId: r.id,
          skillSlug: r.skillSlug,
          ts: r.createdAt,
        });
      for (const sk of (skillsForSearch.data ?? [])
        .filter(
          (sk) =>
            sk.enabled &&
            (sk.slug.includes(q) ||
              sk.name.toLowerCase().includes(q) ||
              sk.description.toLowerCase().includes(q)),
        )
        .slice(0, 5))
        out.push({
          key: `s:${sk.slug}`,
          kind: "skill",
          label: sk.slug,
          title: sk.name,
          path: `/${sk.slug}`,
          runId: null,
          skillSlug: sk.slug,
          ts: 0,
        });
      for (const n of notifications.items
        .filter((n) => n.title.toLowerCase().includes(q) || (n.body ?? "").toLowerCase().includes(q))
        .slice(0, 5))
        out.push({
          key: `n:${n.id}`,
          kind: "notification",
          label: n.title,
          title: n.title,
          path: n.body ?? "",
          runId: n.runId ?? null,
          skillSlug: null,
          ts: n.ts,
        });
    }
    return out;
  }, [
    searching,
    debounced,
    searchList.data,
    fileHits.data,
    runs.data,
    skillsForSearch.data,
    notifications.items,
  ]);

  return { query, setQuery, hits, skills: skillsForSearch.data ?? [] };
}
