# Node, link and knowledge-graph management for an AI second brain (state of the art 2024-2026)

Scope note: about 19 tool calls. I read these primary sources in full or in part: the Zep paper, A-MEM, HippoRAG 2, the Mem0 paper, LightRAG, _RAG vs GraphRAG_ (Han et al.), the LazyGraphRAG blog, Graphiti's dedup source code and the Obsidian help pages. I looked at the MordomoOS code directly in `core/src/db/migrations.ts`, `core/src/memory/{links,graph,hygiene}.ts`. Sources I did NOT fetch: Cognee, KAG, nano-graphrag, Tana/Logseq docs, the Neo4j/Memgraph posts, and the full GraphRAG-Bench results. These appear under Gaps.

## 1. Node granularity: what do agent-memory and KG-memory systems choose, and why?

### Takeaway

No winning system uses only one granularity. They pair a **raw-source layer** (episodes, passages, notes) with a **derived layer** (entities, facts or triples, LLM-enriched note attributes) and link the two. Ablations show the source layer is essential. Removing passage nodes from HippoRAG 2, or dropping raw text from the KG, costs a lot of accuracy. Pure-triple graphs lose about a third of answer entities.

### Cited Findings

- **Zep/Graphiti (Jan 2025)** uses three tiers. (1) _Episode_ nodes hold the raw input: a message, text or JSON. (2) _Semantic entity_ nodes come from episodes, and their edges are facts. (3) _Community_ nodes hold summaries of clusters of strongly connected entities. Episodic edges link episodes to the entities they mention. — [Zep paper, arXiv 2501.13956](https://arxiv.org/html/2501.13956)
- **A-MEM (v11, 8 Oct 2025)** is Zettelkasten-style. The node is an _atomic note_ with 7 attributes: the original content c_i, a timestamp t_i, LLM-generated keywords K_i, tags G_i, a contextual description X_i, an embedding e_i (all-MiniLM-L6-v2, computed over content plus keywords, tags and context), and a set of links L_i. — [A-MEM, arXiv 2502.12110](https://arxiv.org/html/2502.12110)
- **HippoRAG 2 (Feb 2025)** builds a dual-node graph. An LLM (Llama-3.3-70B) extracts OpenIE triples, and their subjects and objects become _phrase nodes_. Each passage becomes a _passage node_ joined to its phrases by "contains" context edges. Removing passage nodes cuts average Recall@5 from 87.1 to 81.0. Replacing query-to-triple matching with NER-to-node drops it to 74.6, and query-to-node drops it to 59.6. — [HippoRAG 2, arXiv 2502.14802](https://arxiv.org/html/2502.14802)
- **Mem0 / Mem0g (Apr 2025)**: Mem0's node is an LLM-extracted _fact_, a short memory string. Mem0g adds a directed labelled graph of typed entities with (source, relation, destination) triplets. — [Mem0 paper, arXiv 2504.19413](https://arxiv.org/html/2504.19413)
- **LightRAG (v3, 28 Apr 2025)** splits text into 1,200-token chunks. It then uses an LLM to extract entities (nodes) and relations (edges), each with a key-value profile. The entity name is the key; relations can carry several keys, including global themes. — [LightRAG, arXiv 2410.05779](https://arxiv.org/html/2410.05779)
- **Pure triples lose evidence.** Only about 65.8% (HotpotQA) and 65.5% (NQ) of answer entities appear in the extracted KG. Triplet-only KG-GraphRAG reaches 39.20 and 32.18 retrieval accuracy, against 88.60 and 86.70 for plain chunk RAG. — [Han et al., _RAG vs. GraphRAG_, arXiv 2502.11371 v3 (Mar 2026)](https://arxiv.org/html/2502.11371v3)
- **Granularity costs storage tokens.** On LoCoMo the stores hold about 7k tokens for Mem0 (facts) and about 14k for Mem0g (facts plus graph). Zep holds over 600k, because it caches a summary at each node and stores facts on edges. The raw conversation averages about 26k tokens. — [Mem0 paper](https://arxiv.org/html/2504.19413)

### Inferences

- For a file-based second brain, the _file/note_ is the right source node (equivalent to Zep's episode or HippoRAG's passage). Any entity or fact layer should be **derived and point back to file and line**. It should never replace the file.
- A-MEM shows a cheap middle path. Enrich each note with LLM keywords, tags and a one-line context, and embed that enriched text. This adds no new node type.

### Gaps

- I did not verify Cognee's node model (its DataPoint, chunk and entity layers) or KAG's schema-constrained "knowledge units" from primary docs.

## 2. Links: explicit vs inferred vs typed; backlinks, suggested links, renames, unlinked mentions

### Takeaway

The literature and the tools converge on three link types. **Explicit** links are written by the user or agent (wikilinks). **Inferred** links come from embedding top-k followed by LLM confirmation (A-MEM), or from synonym edges above a similarity threshold (HippoRAG 2). **Typed** relations are LLM-extracted predicates on edges (Graphiti, Mem0g, LightRAG). Inferred links measurably help retrieval. PKM tools handle renames either by rewriting links (Obsidian) or by resolving by name at query time.

### Cited Findings

- **A-MEM link generation**: compute cosine similarity of the new note against all notes, keep the top-k (k=10 by default, 10-50 in experiments), then an LLM decides which links to create. _Memory evolution_: the LLM also rewrites each neighbour's context, keywords and tags. — [A-MEM](https://arxiv.org/html/2502.12110)
- **The A-MEM ablation measures the value of inferred links**: multi-hop F1 (GPT-4o-mini) is 9.65 without links or evolution, 21.35 with links only, and 27.02 with both. — [A-MEM Table 3](https://arxiv.org/html/2502.12110)
- **A-MEM cost**: about 1,200 tokens per memory operation, against about 16,900 for LoCoMo/MemGPT baselines (Table 1 shows 2,520 for GPT-4o-mini). Each operation costs under $0.0003, taking about 5.4 s with GPT-4o-mini or about 1.1 s with Llama 3.2 1B locally. — [A-MEM](https://arxiv.org/html/2502.12110)
- **Caveat on A-MEM**: in Mem0's independent LoCoMo run, A-MEM scored the lowest overall LLM-judge J of all systems tested, 48.38%. — [Mem0 paper](https://arxiv.org/html/2504.19413)
- **HippoRAG 2 synonym edges**: phrase pairs with embedding similarity above 0.8 are linked. This is cheap similarity-based linking that needs no LLM. — [HippoRAG 2](https://arxiv.org/html/2502.14802)
- **Obsidian** writes wikilinks by default (`[[Note]]`), and Markdown links need a URL-encoded destination. It "can automatically update internal links in your vault when you rename a file", controlled by Settings → Files and links → "Automatically update internal links". It supports heading links (`[[Note#Heading]]`) and block links (`[[Note#^id]]`, where ids are Latin letters, digits and dashes only). Clicking an unresolved link creates the note. — [Obsidian Help: Internal links](https://obsidian.md/help/links)
- **Obsidian backlinks** separate _linked mentions_ (notes that link to the active note) from _unlinked mentions_ (plain-text occurrences of the note's name). — [Obsidian Help: Backlinks](https://obsidian.md/help/Plugins/Backlinks)

### Inferences

- MordomoOS's `note_links` design keeps link text and resolves it at query time; the code comment says "a file that is created, renamed or deleted changes" nothing stored. This is a valid alternative to Obsidian-style rewriting. The cost is that a rename **silently re-targets or breaks** links unless aliases or ids exist. A rename handler that rewrites link text, or alias frontmatter, would close the gap.
- The **unlinked-mentions** feature is cheap on SQLite: run an FTS5 MATCH on each note's name and aliases, then exclude sources that already have a `note_links` row to that target. It is also a natural "suggested links" source alongside `file_related`.
- MordomoOS's TF-IDF `file_related` table is an inferred-link layer, but it has no LLM confirmation step and no typing. A-MEM's ablation suggests that confirmed and enriched links, not just similarity scores, drive the multi-hop gains.

### Gaps

- I found no measured study of link-rot rates or of rename strategies (rewrite vs resolve-at-read) in PKM tools.
- I did not fetch Tana (supertags, typed fields) or Logseq (block refs, page aliases) docs.

## 3. Entity extraction, resolution and deduplication (methods, cost, error rates; near-duplicate notes)

### Takeaway

The state-of-the-art pipeline runs in stages. Extract with an LLM over a short context window. Generate candidates with embeddings and BM25 (plus MinHash/LSH on names). Accept exact or high-Jaccard matches deterministically, and escalate only ambiguous cases to an LLM merge prompt. The deterministic stage is cheap and runs locally. Extraction itself dominates cost, and it misses about a third of answer entities on QA benchmarks.

### Cited Findings

- **Graphiti extraction** uses the current message plus the last n=4 messages and a Reflexion-style reflection step to reduce hallucination. Entity names are embedded (1024-d) and matched by cosine similarity _and_ full-text search on names and summaries. An LLM resolution prompt then decides about duplicates and writes an updated name and summary. Insertion uses fixed Cypher queries, not LLM-generated ones. Fact (edge) dedup works the same way, limited to edges between the same entity pair. — [Zep paper](https://arxiv.org/html/2501.13956)
- **Graphiti deterministic dedup (current `main`)**. Step 1 is an exact match on a lowercased, whitespace-collapsed name. Step 2 is an entropy gate: names under 6 characters with fewer than 2 tokens fail, and the rest need Shannon entropy ≥ 1.5. Step 3 builds MinHash over 3-gram shingles, with 32 permutations (BLAKE2b) and LSH in 8 bands of 4. Step 4 accepts the best candidate at Jaccard ≥ 0.9. Anything ambiguous goes to the LLM. — [graphiti `dedup_helpers.py`](https://raw.githubusercontent.com/getzep/graphiti/main/graphiti_core/utils/maintenance/dedup_helpers.py)
- **Mem0** extracts facts using a conversation summary, the last 10 messages and the new pair. It retrieves the 10 most similar memories, and the LLM picks ADD, UPDATE, DELETE or NOOP via a tool call. — [Mem0 paper](https://arxiv.org/html/2504.19413)
- **LightRAG** merges identical entities and relations from different chunks by key (the name). This is exact-name dedup. — [LightRAG](https://arxiv.org/html/2410.05779)
- **Normalization before the LLM**: sift-kg reports that Unicode folding, singularization and title stripping usually cut entity counts by 10-30% before the LLM stage (vendor documentation, not peer-reviewed). — [sift-kg docs](https://www.mintlify.com/juanceresa/sift-kg/concepts/entity-resolution)
- **MinHash/LSH** estimates Jaccard similarity and buckets candidates without comparing every pair. On character n-grams it tolerates spelling errors but loses some precision. — [TU Delft thesis on LSH for ER](https://repository.tudelft.nl/file/File_9dd1e462-621e-4542-a566-fdfdf02bfea1?preview=1); [EnergyGPT, arXiv 2509.07177](https://arxiv.org/pdf/2509.07177)
- **The extractor model matters**: on MultiHop-RAG, a graph built by GPT-4o scores 75.08 overall against 71.17 for one built by GPT-4o-mini. Temporal accuracy rises from 49.06 to 58.49. — [Han et al.](https://arxiv.org/html/2502.11371v3)
- **Extraction cost at corpus scale** (MuSiQue, 11,656 passages): HippoRAG 2 needs 9.2M input and 3.0M output tokens and 99.5 min to index. LightRAG needs 68.5M/18.3M tokens and 235 min, GraphRAG 115.5M/36.1M and 277 min. Plain embedding (NV-Embed-v2) needs no LLM tokens and 12.1 min. — [HippoRAG 2 Table 12](https://arxiv.org/html/2502.14802)

### Inferences

- For a local single-user system, Graphiti's deterministic layer (exact match, entropy gate, MinHash on names) is pure CPU and needs no new dependency. A small table keyed by normalized name can hold it. Escalation to an LLM can be batched and optional.
- **Near-duplicate _notes_** (not entities) can be caught the same way. MordomoOS already stores per-file embeddings in `file_vectors` and TF-IDF in `file_related`. Pairs with cosine above a threshold, or MinHash on content shingles, would produce a "possible duplicate" hygiene item. MordomoOS currently has none; a grep of `core/src` finds no MinHash, SimHash or near-duplicate logic in memory.

### Gaps

- I found no published _error rates_ (precision/recall) for Graphiti's or Mem0's entity resolution. The Zep paper reports end-task accuracy only.
- I found no per-note cost figure for entity extraction on personal-notes corpora. Corpus figures (HippoRAG 2 table) are the best proxy.

## 4. GraphRAG and successors: communities, global vs local, when GraphRAG wins or loses, cost critiques

### Takeaway

GraphRAG-style systems with community summaries (Microsoft 2024) help with _global sensemaking_ and some multi-hop, temporal and comparison questions. They lose to plain RAG on single-hop and detail questions, hallucinate on null queries, and cost 10-100× more to index. Successors cut that cost sharply. LazyGraphRAG indexes at 0.1% of GraphRAG's cost; LightRAG retrieves with under 100 tokens; HippoRAG 2 runs PPR over a lean triple graph. Hybrids that combine RAG and GraphRAG beat either one alone.

### Cited Findings

- **Microsoft GraphRAG (Edge et al., Apr 2024)** builds an entity graph with an LLM, partitions it into hierarchical communities with Leiden, and pre-generates a summary per community. Global queries map-reduce over those summaries. The paper targets "global sensemaking" over corpora around 1M tokens. — [arXiv 2404.16130](https://arxiv.org/abs/2404.16130) (abstract-level claim; I did not re-fetch its win-rate numbers)
- **LazyGraphRAG (MSR blog, 25 Nov 2024; integrated into Microsoft Discovery/Azure Local per a 6 Jun 2025 note)**. It indexes with NLP noun-phrase extraction and co-occurrence, uses graph statistics for hierarchical communities, and makes **no LLM summarization at index time**. Index cost is "identical to vector RAG and 0.1% of the costs of full GraphRAG". At quality comparable to GraphRAG Global Search, query cost is over 700× lower. At 4% of GraphRAG C2 query cost (budget Z500), it beats all methods on both local and global queries. The evaluation used 5,590 AP articles and 100 queries with an LLM judge. — [MSR blog](https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/)
- **LightRAG** uses dual-level retrieval. Low-level matches entities and their 1-hop neighbours; high-level matches themes. Updates are incremental: new nodes and edges are unioned into the graph. On the Legal set, GraphRAG retrieval used about 610 communities × 1,000 tokens (about 610,000 tokens, hundreds of calls), while LightRAG used under 100 tokens in 1 call. LightRAG's win rate against GraphRAG is roughly 50-55% (Agriculture 54.8%, CS 52.0%, Legal 52.8%, Mix 49.6%); against NaiveRAG it is 60-85%. — [LightRAG](https://arxiv.org/html/2410.05779)
- **HippoRAG 2** seeds Personalized PageRank (damping 0.5) with filtered phrase nodes, with passage nodes weighted 0.05. Average F1 is 59.8 against 57.0 for NV-Embed-v2 dense retrieval (2Wiki 71.0 vs 61.5; MuSiQue 48.6 vs 45.7). Simple QA does not degrade (NQ 63.3 vs 61.9). It is described as a 7% gain on associative tasks. Queries take 1.2 s against 10.7 s for GraphRAG and 13.3 s for LightRAG. — [HippoRAG 2](https://arxiv.org/html/2502.14802)
- **Where RAG wins (Han et al., Feb 2025 / v3 Mar 2026; Llama-3.1-8B)**. On NQ, RAG scores 64.78 F1 against 61.03 for HippoRAG2. On NovelQA detail questions RAG scores 55.28, against 46.88 for Community-GraphRAG Local and 30.89 for Global. On MultiHop-RAG null queries RAG scores 96.01 and Global GraphRAG 19.27, a hallucination risk. — [Han et al.](https://arxiv.org/html/2502.11371v3)
- **Where GraphRAG wins (same paper)**. HotpotQA: HippoRAG2 63.01 vs RAG 60.04. MultiHop-RAG overall: 70.27 vs 67.02. Temporal: Community-GraphRAG Local 50.60 vs 30.70. Comparison: Global 64.02 vs 57.59. — [Han et al.](https://arxiv.org/html/2502.11371v3)
- **Evaluation bias**: in LLM-as-judge summarization comparisons, reversing answer order can flip the verdict. With reference metrics (ROUGE-2 on SQuALITY) RAG and Local GraphRAG are tied (10.08 vs 10.10), and Global trails (6.99). — [Han et al.](https://arxiv.org/html/2502.11371v3)
- **Hybrid**: on MultiHop-RAG (70B), routing between RAG and GraphRAG (Selection) gains 1.1%, and running both and merging (Integration) gains 6.4%. — [Han et al.](https://arxiv.org/html/2502.11371v3)
- **Build and query cost (MultiHop-RAG)**. RAG: 135 s to build, 1,724 s to retrieve. KG-GraphRAG: 7,702 s and 14,434 s. Community-GraphRAG: 5,560 s and 1,249 s. — [Han et al.](https://arxiv.org/html/2502.11371v3)
- **GraphRAG-Bench (Jun 2025, v3 Feb 2026)**: its abstract notes "GraphRAG frequently underperforms vanilla RAG on many real-world tasks". It builds a tiered benchmark covering fact retrieval, complex reasoning, contextual summarization and creative generation. — [arXiv 2506.05690](https://arxiv.org/abs/2506.05690)
- **Zep community detection** uses _label propagation_ instead of Leiden, because it has a simple dynamic extension: a new entity joins its neighbours' plurality community. Periodic full refreshes are still needed. — [Zep paper](https://arxiv.org/html/2501.13956)

### Inferences

- For a personal vault (typically far under 1M tokens, and queried mostly for specific facts), full GraphRAG with community summaries is unlikely to pay off. LazyGraphRAG-style deferred work (no LLM at index, communities from co-occurrence, LLM only at query time) or HippoRAG-style PPR over a lean graph fits better.
- Integration wins in the hybrid results, which supports keeping BM25/FTS5 and embeddings as the primary retriever and using the graph to _expand and re-rank_, not to replace them.

### Gaps

- I did not extract GraphRAG-Bench's per-task numbers or guidelines; only the abstract was read.
- KAG (Ant Group) and nano-graphrag were not covered from primary sources.

## 5. Temporal knowledge graphs: bi-temporal edges, invalidation, episodes

### Takeaway

The reference design is Graphiti's **bi-temporal edge**. It records event time (`t_valid`, `t_invalid`) separately from system time (`t'_created`, `t'_expired`), and **invalidates contradicted facts instead of deleting them**. Each fact keeps provenance through the episodes that produced it. The measured benefit appears on temporal questions.

### Cited Findings

- **Graphiti timelines**: T (event time) uses t_valid and t_invalid for when a fact held true. T′ (transaction time) uses t′_created and t′_expired for when the system learned or retired it. On contradiction, an LLM compares new edges with related existing edges and sets the old edge's t_invalid to the new edge's t_valid, with newer information taking priority on T′. — [Zep paper](https://arxiv.org/html/2501.13956)
- **Zep on LongMemEval (about 115k-token conversations)**. With gpt-4o, accuracy is 71.2% against 60.2% for full context, latency 2.58 s against 28.9 s, and context about 1.6k tokens against 115k. With gpt-4o-mini, accuracy is 63.8% against 55.4%. Zep was worse on single-session-assistant questions (−17.7% with gpt-4o). — [Zep paper](https://arxiv.org/html/2501.13956)
- **Zep on DMR**: 94.8% against 93.4% for MemGPT (gpt-4-turbo). The paper notes each DMR conversation has only about 60 messages, so the benchmark is weak. — [Zep paper](https://arxiv.org/html/2501.13956)
- **Mem0g** marks outdated relationships _invalid_ rather than deleting them, to support temporal reasoning. Its graph variant gains on temporal questions (J 58.13 vs 55.51) and loses on single-hop (65.71 vs 67.13) and multi-hop (47.19 vs 51.15). On LoCoMo overall J, Mem0g scores 68.44%, Mem0 66.88%, Zep 65.99%, best RAG 60.97% and full context 72.90%. — [Mem0 paper](https://arxiv.org/html/2504.19413)
- **The benchmarks are disputed.** Zep's own LoCoMo figure was first about 84%, then corrected to 75.14% (a 10-run average) after Mem0 pointed out a denominator error. Mem0 measured Zep at 58.44 or 65.99. Scores shift by more than 10 points with the answer model, judge, prompt and question exclusions, and LoCoMo has only 10 conversations. These are secondary sources; I did not find the primary Zep/Mem0 posts. — [braindetox analysis (2026)](https://braindetox.kr/en/posts/memory_benchmark_scores_reliability_2026.html); [Mem0: how to read memory benchmarks](https://mem0.ai/library/agent-memory/how-to-read-memory-benchmarks)

### Inferences

- In SQLite, bi-temporality takes four nullable INTEGER columns on a facts/edges table, plus an `episode_id`/`file_id`+`line` provenance column. Queries for "what was true at T" become `WHERE t_valid <= T AND (t_invalid IS NULL OR t_invalid > T) AND t_expired IS NULL`.
- MordomoOS link tables have no validity interval; only `file_related.updated_at` exists. For a _file_ brain, a file's git or mtime history is the episode log. A lightweight start would timestamp when each `note_links` row first and last appeared.

### Gaps

- I found no primary data on how often LLM contradiction detection produces false invalidations.

## 6. Graph hygiene: orphans, hubs, broken links, staleness, merge/split, importance, pruning

### Takeaway

The literature offers few formal hygiene metrics. Useful signals come from graph statistics: degree and PageRank for importance and hubs, communities for clustering and split candidates, PPR for retrieval. There are also LLM-maintained processes: A-MEM's memory evolution rewrites neighbours, Mem0's UPDATE/DELETE/NOOP, and Graphiti's invalidation plus periodic community refresh. MordomoOS's hygiene covers the basics, but its orphan check runs on the legacy table.

### Cited Findings

- **PageRank as a retrieval primitive**: HippoRAG 2 ranks passages by Personalized PageRank from query-seeded nodes. — [HippoRAG 2](https://arxiv.org/html/2502.14802)
- **Graphiti rerankers** use graph signals: an _episode-mentions_ reranker (how often an entity or fact is mentioned) and a _node-distance_ reranker (hops from a centre node). These sit alongside RRF, MMR and cross-encoders. — [Zep paper](https://arxiv.org/html/2501.13956)
- **Periodic recomputation** is unavoidable: Zep's incremental label-propagation communities "gradually diverge" and need full refreshes. — [Zep paper](https://arxiv.org/html/2501.13956)
- **Maintenance by rewriting**: A-MEM's evolution step updates neighbours' context, keywords and tags. Mem0 chooses ADD, UPDATE, DELETE or NOOP per fact. — [A-MEM](https://arxiv.org/html/2502.12110); [Mem0](https://arxiv.org/html/2504.19413)
- **MordomoOS today (code)**. `memoryHygiene()` reports orphans, dangling router pointers and stale files (mtime older than 90 days by default). The **orphan query reads `file_links` with kind `markdown-link`, not `note_links`**. Wikilink-only notes can therefore show up as orphans, or the reverse, depending on how the legacy indexer fills `file_links`. `buildGraph()` also reads `file_links`. `file_links.kind` includes `same-dir` and `same-area` structural edges. No degree, PageRank, hub, near-duplicate or merge/split signal exists. — local code: `core/src/memory/hygiene.ts` (lines 94-103), `core/src/memory/graph.ts` (line 73), `core/src/db/migrations.ts` (lines 88-93, 310-318, 496-503)

### Inferences

- Cheap additions, all SQLite plus in-process code:
  - **broken links**: `note_links` targets that resolve to no file, reusing `resolveWikilink`.
  - **hubs**: in-degree above the p99 percentile.
  - **importance**: PageRank by power iteration over `note_links` in TS. Even 10k nodes take milliseconds.
  - **near-duplicates**: `file_vectors` cosine above about 0.95, or MinHash.
  - **split candidates**: very long notes with many headings and low internal cohesion.
  - **merge candidates**: near-duplicates, or entities that resolve to the same canonical name.
- Moving orphan detection and the graph view onto `note_links` (resolved at read time) would remove the dual source of truth.

### Gaps

- I found no empirical study that ties PKM hygiene actions (pruning orphans, splitting hubs) to retrieval or answer quality.

## 7. Practical guidance for a local, single-user SQLite system (cost-tiered), and gaps for MordomoOS

### Takeaway

Most of the _structure_ is cheap on SQLite: link tables, recursive-CTE BFS, in-process PageRank and PPR, FTS5 unlinked mentions, MinHash dedup, bi-temporal columns. The _expensive_ parts are LLM entity and relation extraction and LLM summaries. Run those lazily, at query time or in idle batches (LazyGraphRAG, A-MEM's roughly 1.2k tokens per note), not as a full GraphRAG index.

### Cited Findings

- No-LLM indexing is viable and competitive. LazyGraphRAG uses noun-phrase co-occurrence graphs at vector-RAG index cost. — [MSR blog](https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/)
- LLM extraction costs roughly 9M (HippoRAG 2) to 115M (GraphRAG) input tokens per about 11.7k passages. — [HippoRAG 2](https://arxiv.org/html/2502.14802)
- Graphiti's resolution pre-filter is pure Python hashing (MinHash, 32 permutations, Jaccard 0.9). — [graphiti source](https://raw.githubusercontent.com/getzep/graphiti/main/graphiti_core/utils/maintenance/dedup_helpers.py)
- A-MEM-style linking costs under $0.0003 per note, or about 1.1 s with a 1B local model. — [A-MEM](https://arxiv.org/html/2502.12110)
- Hybrid search (cosine + BM25 + graph BFS, fused by RRF) is the Graphiti retrieval baseline. — [Zep paper](https://arxiv.org/html/2501.13956)

### Inferences

Gaps of MordomoOS against the literature, ranked by value to cost:

1. **Two link sources of truth**: `note_links` (text, resolved at read) and the legacy `file_links` (resolved ids) still feed the graph view and orphans. Unifying them is cheap and fixes correctness.
2. **No unlinked mentions or link suggestions** beyond TF-IDF `file_related`. FTS5 plus embeddings can add them cheaply. An optional LLM confirmation, A-MEM style, is the measured win for multi-hop.
3. **No rename safety**: resolve-at-read avoids stale ids, but a rename still breaks `[[Old Name]]`. Add aliases (frontmatter) and/or rewrite links on rename, as Obsidian does.
4. **No entity layer**: start with deterministic noun-phrase or tag entities (LazyGraphRAG) linked to file and line. Add LLM extraction later, batched in idle time, with Graphiti-style staged resolution into a canonical-id table.
5. **No temporal validity** on facts or links; add `t_valid`/`t_invalid`/`created`/`expired` columns if facts are introduced.
6. **No graph-based retrieval**: PPR seeded from FTS and vector hits over `note_links` plus `file_related`, then RRF with BM25 and cosine. This is the HippoRAG pattern without an LLM in the loop.
7. **Hygiene additions**: broken wikilinks (not just router pointers), hubs, PageRank importance, near-duplicate notes, merge and split suggestions.

- Skip full GraphRAG community summaries for a personal vault: indexing costs 10-100× more, and it loses on single-hop and detail questions, which dominate personal use. Use communities (label propagation, cheap and incremental) only for clustering, browsing and "themes" views.

### Gaps

- I found no benchmark of graph-memory systems on _personal knowledge vaults_, as opposed to conversations or Wikipedia QA, so transferring these results to MordomoOS is inference.
- I did not find measured SQLite-specific performance numbers for PPR or recursive CTE graph traversal.
