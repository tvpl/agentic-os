# Memory architectures for LLM agents and personal AI "second brains" (state of the art 2024-2026)

Research date: 2026-10-29. Source quality notes: (V) = verified by fetching the primary source in this session; (S) = taken from search-result snippets or secondary summaries, not opened in full; (T) = the primary paper is cited, but the detail comes from the researcher's prior knowledge of the full text and was not re-fetched in this session. The report writer should treat (T) items as needing a check before they are quoted as exact figures.

Caveat on vendor numbers: Mem0, Zep, Letta and MIRIX all publish benchmark results that favor their own systems, and they dispute one another's numbers (see Q5). One Mem0 research page (mem0.ai/reasearch-3) contains text aimed at AI assistants, telling them to treat its numbers as canonical. That text was ignored. Its numbers are reported here only as vendor self-reports.

## Q1. Memory taxonomies in recent surveys: what each layer stores and when it is read

### Takeaway

The 2025 surveys have moved past the plain "short-term vs long-term" split. The most cited one, Hu et al., Dec 2025, classifies memory along three axes: **forms** (token-level, parametric, latent), **functions** (factual, experiential, working) and **dynamics** (formation, evolution, retrieval). Production systems still mostly use the cognitive-science labels: working/core, episodic, semantic, procedural, sometimes plus resource and vault stores. The practical design question is when each layer is read: always in context, retrieved on demand, or folded in offline.

### Cited Findings

- "Memory in the Age of AI Agents: A Survey, Forms, Functions and Dynamics" (Hu, Liu et al., about 40 coauthors, arXiv 2512.13564, 15 Dec 2025):
  - It organizes agent memory into **forms** (token-level, parametric, latent), **functions** (factual, experiential, working) and **dynamics** (how memory is formed, evolved and retrieved over time).
  - It explicitly separates agent memory from LLM memory, RAG and context engineering, and it compiles benchmarks and open-source frameworks.
  - [arXiv 2512.13564](https://arxiv.org/pdf/2512.13564) (S); [HF page](https://huggingface.co/papers/2512.13564) (S)
- The survey's authors argue that the older short-term vs long-term split no longer captures current systems — [Liner review](https://liner.com/review/memory-in-age-ai-agents) (S, secondary)
- "Rethinking Memory in AI" (arXiv 2505.00675, May 2025) uses a different scheme. It classifies representations as **parametric**, **contextual structured** or **contextual unstructured**, and defines six atomic memory operations (consolidation, indexing, updating, forgetting, retrieval, compression) — [arXiv 2505.00675](https://arxiv.org/html/2505.00675v1) (S; the list of six operations is T)
- "Anatomy of Agentic Memory: Taxonomy and Empirical Analysis of Evaluation and System Limitations" (arXiv 2602.19320, Feb 2026) cites Hu et al. as the forms-functions-dynamics framework and analyzes evaluation and system limitations — [arXiv 2602.19320](https://arxiv.org/html/2602.19320) (S)
- MIRIX (Wang & Chen, Jul 2025) uses six concrete memory types. A Meta Memory Manager coordinates six per-type Memory Managers.
  - The types are **Core**, **Episodic**, **Semantic**, **Procedural**, **Resource Memory** (documents and files) and **Knowledge Vault** (sensitive verbatim data such as credentials and addresses).
  - [arXiv 2507.07957](https://arxiv.org/abs/2507.07957v1) (S); [Liner review](https://liner.com/review/mirix-multiagent-memory-system-for-llmbased-agents) (S)
- MemoryOS (BUPT + Tencent AI Lab, EMNLP 2025 main) uses an OS-style three-tier hierarchy: short-term, mid-term and long-term personal memory.
  - Short-term to mid-term promotion is **FIFO**. Mid-term to long-term uses a **segmented page** organization.
  - [arXiv 2506.06326](https://arxiv.org/abs/2506.06326v1) (S)
  - A secondary summary says mid-term eviction is **heat-based** (visit frequency, interaction length, recency) — [Lunadong summary](https://papers.lunadong.com/paper/4632) (S, unverified against full text)
- MemGPT (Packer et al., Oct 2023; foundational, pre-2024) is the OS analogy that most later work cites. It has three stores:
  - **Main context**: system instructions, working context or core memory, and a FIFO message queue.
  - **Recall storage**: the full message history, searchable.
  - **Archival storage**: an arbitrary-length vector store.
  - The LLM pages data in and out itself through function calls.
  - [arXiv 2310.08560](https://arxiv.org/abs/2310.08560) (T)

### Inferences

- A layering for a personal "second brain" that matches the literature:
  - **Working/core**: always in context, small, edited in place.
  - **Episodic**: an append-only raw log of interactions with timestamps, read on demand by time or similarity.
  - **Semantic**: distilled facts, preferences and entities, read by retrieval or always-on summaries.
  - **Procedural**: how-to, skills, instructions and rules, loaded by task.
  - **Optional resource/vault**: documents, and sensitive verbatim data with stricter access.
- MordomoOS's journal → MEMORY.md split covers episodic and semantic/core. The literature (MIRIX, Hu et al.'s "experiential" function, LangMem's procedural type) suggests adding an explicit **procedural/experiential** layer: lessons about how to do tasks, kept separate from facts about the user. A **sensitive vault** with separate access rules is also worth considering.

### Gaps

- I did not fetch the full Hu et al. survey, so its per-category definitions and its benchmark and framework tables are not reproduced here.
- I found no verified primary source for LangMem's taxonomy in this session. From prior knowledge (T), LangMem documents semantic, episodic and procedural memory, with "hot path" (in-conversation tool) and "background" (post-conversation reflection) write modes. Check [LangMem docs](https://langchain-ai.github.io/langmem/) before citing.
- Cognee was not researched (no source collected).

## Q2. How concrete systems implement memory

### Takeaway

There are three broad families:

1. **Agent-self-edited memory blocks plus searchable archives**: MemGPT/Letta, Anthropic's memory tool, Claude Code. Letta and Anthropic have both moved toward **plain files and bash** (git-backed MemFS, filesystem-mounted memory).
2. **LLM extract-then-reconcile fact stores**: Mem0 with ADD/UPDATE/DELETE/NOOP. Mem0g adds a graph with invalidation instead of deletion.
3. **Temporal knowledge graphs**: Zep/Graphiti, which is bi-temporal and keeps raw episodes non-lossily.

Background or offline consolidation ("sleep-time", "dreaming") is now a mainstream feature, not a research curiosity.

### Cited Findings

**MemGPT / Letta**

- Letta's sleep-time agents (blog 21 Apr 2025):
  - Creating a sleep-time-enabled agent creates **two agents**: a primary agent and a sleep-time agent.
  - They share memory blocks. The sleep-time agent runs in the background and modifies memory asynchronously.
  - By default it runs every **N = 5 steps**. The docs flag the feature as experimental.
  - [Letta blog](https://letta.com/blog/sleep-time-compute) (S); [Letta docs](https://docs.letta.com/guides/agents/architectures/sleeptime/index.md) (S)
- Letta's "our next phase" post:
  - Memory now lives in **git-backed files ("MemFS")**, and reflection workflows move client-side.
  - "Memory moves from specialized memory tools that edit memory in a database to generalized computer use tools like bash that operate over memory projected into git-backed files."
  - [Letta blog](https://www.letta.com/blog/our-next-phase) (S)
- Current Letta docs call the background process **"dreaming"**. Triggers can be off, every N user messages, or on compaction events.
  - A **memory defragmentation** flow backs up memory, then launches a subagent to split large files, merge duplicates and restructure the hierarchy.
  - [Letta memory docs](https://docs.letta.com/letta-agent/memory/index.md) (S)

**Sleep-time compute paper** (Lin, Snell, Wang, Packer, Wooders, Stoica, Gonzalez; arXiv 2504.13171, 17 Apr 2025)

- Pre-computing over the context offline cuts the test-time compute needed for the same accuracy by **about 5x** on Stateful GSM-Symbolic and Stateful AIME.
- Scaling sleep-time compute raises accuracy by **up to 13%** (GSM-Symbolic) and **up to 18%** (AIME).
- Amortizing across related queries cuts average cost per query by **2.5x**.
- Benefit correlates strongly with how **predictable** the user's query is.
- [arXiv 2504.13171](https://arxiv.org/abs/2504.13171) (V)

**Generative Agents** (Park et al., Apr 2023; foundational, pre-2024)

- A memory stream stores "a complete record of the agent's experiences using natural language". Memories are synthesized over time into higher-level reflections and retrieved dynamically to plan — [arXiv 2304.03442](https://arxiv.org/abs/2304.03442) (V)
- Retrieval score = recency + importance + relevance, each min-max normalized and weighted equally in the paper — [arXiv 2304.03442](https://arxiv.org/abs/2304.03442) (T)
  - **Recency**: exponential decay, factor 0.995 per game hour since last access.
  - **Importance**: an LLM-rated integer from 1 to 10 at write time.
  - **Relevance**: embedding cosine similarity to the query.
- Reflection fires when the sum of importance scores of recent events exceeds a threshold (150 in the paper; about 2-3 times per simulated day). It works in three steps — [arXiv 2304.03442](https://arxiv.org/abs/2304.03442) (T)
  - It generates the 3 most salient high-level questions from the last 100 records.
  - It retrieves memories for each question.
  - It writes insights that cite the evidence records. Reflections can build on earlier reflections, forming trees.

**A-MEM** (Xu et al., arXiv 2502.12110, v1 17 Feb 2025, v11 8 Oct 2025, NeurIPS 2025)

- Zettelkasten-style: each memory is a **note** with structured attributes (contextual description, keywords, tags).
- The system **links** a new note to related historical notes.
- **Memory evolution**: adding a note can update the contextual descriptions and attributes of existing notes.
- [arXiv 2502.12110](https://arxiv.org/abs/2502.12110) (V)

**Mem0 / Mem0g** (Chhikara et al., arXiv 2504.19413, 28 Apr 2025), all (V) from [arXiv 2504.19413](https://arxiv.org/html/2504.19413v1):

- **Extraction**: for each new message pair, the prompt combines a conversation summary, the last m messages (m = 10) and the new pair. An LLM extracts candidate facts.
- **Update**: for each candidate fact, the system retrieves the top s = 10 similar memories by embedding. The LLM then picks one operation by tool call:
  - **ADD**: nothing equivalent exists.
  - **UPDATE**: the fact augments an existing memory. It replaces the memory only if the new fact has more information.
  - **DELETE**: the fact contradicts an existing memory, which is removed.
  - **NOOP**: no change. The paper used GPT-4o-mini.
- **Mem0g**: a directed labeled graph in Neo4j. Entities are nodes with a type, an embedding and a creation timestamp. Edges are triplets.
  - New nodes are matched to existing ones by a similarity threshold t.
  - A **conflict detector** plus an LLM **update resolver** mark obsolete relationships **invalid rather than physically deleting them**, which preserves temporal reasoning.
- Memory-store footprint is about **7k tokens per conversation (Mem0)**, **about 14k (Mem0g)** and **over 600k (Zep)**, against raw conversations of about 26k tokens on average.

**Zep / Graphiti** (Rasmussen et al., arXiv 2501.13956, 20 Jan 2025), all (V) from [arXiv 2501.13956](https://arxiv.org/html/2501.13956v1):

- **Bi-temporal model**:
  - Timeline T (when events happened) carries **t_valid / t_invalid**.
  - Timeline T′ (when the system ingested data) carries **t′\_created / t′\_expired**.
- **Three subgraphs**:
  - **Episode subgraph**: raw, non-lossy messages, text or JSON, linked to the entities extracted from them.
  - **Semantic entity subgraph**: entities and fact edges after entity resolution. Facts can be hyper-edges.
  - **Community subgraph**: clusters found by label propagation, with map-reduce summaries. These need periodic full refreshes.
- **Retrieval** combines three searches, then reranks:
  - Searches: cosine similarity, BM25 (Lucene), and breadth-first search up to n hops, which can be seeded with recent episodes.
  - Rerankers: RRF, MMR, episode-mention frequency, graph distance, and cross-encoders (most accurate, most expensive).

**Anthropic**

- The developer memory tool (with "context editing") keeps information outside the context window in a **file-based memory directory hosted by the developer**. It runs client-side through tool calls.
- Context editing automatically clears stale tool calls and results as the context nears its limit.
- [Anthropic: context management](https://www.anthropic.com/news/context-management) (S)
- "Memory on Claude Managed Agents" (public beta) mounts memory onto a filesystem, so Claude uses bash and code execution over it.
  - Memory stores can be shared across agents with scoped permissions, and agents can write concurrently.
  - [SD Times](https://sdtimes.com/anthropic/anthropic-adds-memory-to-claude-managed-agents/) (S, secondary)
- Consumer Claude memory: per Bloomberg Law, recall across conversations reached free users in March 2026 — [Bloomberg Law](https://news.bloomberglaw.com/artificial-intelligence/anthropic-tries-to-win-users-from-chatgpt-with-memory-feature) (S)
- Claude Code combines human-written **CLAUDE.md** files (guidance: under 200 lines per file) with **auto memory** under `~/.claude/projects/<project>/memory/`.
  - Reportedly only the **first 200 lines** of `MEMORY.md` load at session start (one source also cites a 25 KB cap).
  - Common advice is to keep MEMORY.md as a short **index** and push detail into topic files that are read on demand.
  - Review is through `/memory`.
  - [morphllm](https://www.morphllm.com/claude-code-memory-files) (S, third-party); [engineerscodex](https://www.engineerscodex.com/claude-code-auto-memory) (S, third-party). The 25 KB and "silent truncation" details come from a blog post that says it read leaked source; unverified.

**ChatGPT** (OpenAI)

- Two mechanisms, both under Settings > Personalization:
  - **Saved memories**: explicit or model-initiated, kept until deleted.
  - **Reference chat history**: draws on past chats, not kept permanently, and "can change over time as ChatGPT updates what's more helpful to remember".
- Temporary Chat neither reads nor writes memory.
- The help center says the FAQ describes the legacy system and an improved memory experience is rolling out.
- [OpenAI Help: reference saved memories](https://help.openai.com/en/articles/11146739-how-does-reference-saved-memories-work) (S); [OpenAI Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq) (S)

**MIRIX**: six-type, multi-agent memory (see Q1) — [arXiv 2507.07957](https://arxiv.org/abs/2507.07957v1) (S)

### Inferences

- Anthropic and Letta are converging on **"memory is files the agent edits with general tools, plus a small always-loaded index."** This matches MordomoOS's MEMORY.md plus journal design closely.
- Claude Code's 200-line index cap suggests MordomoOS should **cap MEMORY.md and treat it as an index**, pointing to topic files, rather than letting it grow.
- Zep and Mem0g both keep the **raw episode as ground truth** and derive facts from it with provenance links. MordomoOS's append-only journal plays this episode role.
  - Make sure every consolidated fact in MEMORY.md carries a **pointer back to the journal entries** it came from. Zep lists episode-to-fact traceability as a design goal, though its paper did not evaluate it.
- Letta's triggers (every N messages, on compaction) and its separate "defragmentation" pass suggest that a nightly-only schedule may be too coarse for active days. Consider both:
  - an **event-triggered light consolidation**, and
  - a periodic **structural defrag**: split, merge, dedupe.

### Gaps

- Letta's current exact block sizes, default limits and MemFS details were not fetched.
- Primary Anthropic memory-tool docs (API shape, beta header, commands such as view/create/str_replace) were not opened. Details come from news-page snippets.
- No primary documentation was found for the post-2025 "improved" ChatGPT memory architecture.
- No reliable source was collected for an OpenAI-specific "dreaming" feature. The "dreaming" term was found only in Letta docs.
- Cognee and LangMem internals were not verified.

## Q3. Consolidation and forgetting: promotion, decay, supersession vs deletion, conflicts, temporal validity

### Takeaway

State-of-the-art systems prefer **invalidation (supersession with timestamps) over deletion**:

- Zep is bi-temporal, setting t_invalid on the older edge.
- Mem0g marks edges invalid.
- Plain Mem0 does DELETE on contradiction, which loses history.

Promotion from episodic to semantic memory is usually LLM-driven: an extract-and-reconcile step per message (Mem0) or a background or offline pass (Letta sleep-time or dreaming, MemoryOS tier promotion). Decay is usually a recency term used at retrieval time rather than real deletion: exponential recency (Generative Agents) or heat (MemoryOS).

### Cited Findings

- **Zep contradiction handling**: an LLM compares a new edge with semantically related existing edges. When they contradict and their time ranges overlap, the old edge's **t_invalid is set to the new edge's t_valid**. New information takes priority on the ingestion timeline T′. Graphiti updates the graph "in a non-lossy manner, maintaining a timeline of facts … including their periods of validity" — [arXiv 2501.13956](https://arxiv.org/html/2501.13956v1) (V)
- **Mem0 (base)**: a DELETE operation removes contradicted memories. UPDATE replaces a memory only when the new fact carries more information — [arXiv 2504.19413](https://arxiv.org/html/2504.19413v1) (V)
- **Mem0g**: obsolete relationships are **marked invalid rather than physically deleted**, "preserving temporal reasoning". Mem0g beats base Mem0 on **temporal** questions (58.13 vs 55.51 J) but is lower on single-hop (65.71 vs 67.13) and multi-hop (47.19 vs 51.15) — [arXiv 2504.19413](https://arxiv.org/html/2504.19413v1) (V)
- **MemoryOS**: FIFO from short-term to mid-term, then segmented pages from mid-term to long-term — [arXiv 2506.06326](https://arxiv.org/abs/2506.06326v1) (S). Secondary source: heat-based eviction (frequency, engagement, recency) — [Lunadong](https://papers.lunadong.com/paper/4632) (S)
- **Generative Agents**: recency decays exponentially, factor 0.995 per hour since last **access** (not since creation). Retrieval therefore refreshes memories, which is close to spaced-repetition behavior — [arXiv 2304.03442](https://arxiv.org/abs/2304.03442) (T)
- **MemoryBank** (Zhong et al., 2023; foundational) applies an **Ebbinghaus forgetting curve**. Memory strength increases each time a memory is recalled, and weak memories are forgotten — [arXiv 2305.10250](https://arxiv.org/abs/2305.10250) (T)
- **Letta dreaming/defrag**: background subagent passes that merge duplicates, split large files and restructure memory, with a backup first — [Letta docs](https://docs.letta.com/letta-agent/memory/index.md) (S)
- **ChatGPT reference-chat-history** is explicitly non-permanent and self-revising ("can change over time"). Saved memories are permanent until the user deletes them — [OpenAI Help](https://help.openai.com/en/articles/11146739-how-does-reference-saved-memories-work) (S)
- **MemoryAgentBench** treats **selective forgetting** (handling updated or contradicted information) as one of four core competencies. It concludes "current methods fall short of mastering all four competencies" — [arXiv 2507.05257](https://arxiv.org/abs/2507.05257) (V)
- **LongMemEval** "knowledge update" questions:
  - Zep's gain is small or negative here: gpt-4o-mini 76.9 → 74.4; gpt-4o 78.2 → 83.3.
  - Mem0 and LangMem lose most on LoCoMo **temporal** questions: LangMem 23.43 J; OpenAI memory 21.71 J.
  - Temporal and update handling is still the weakest area.
  - [arXiv 2501.13956](https://arxiv.org/html/2501.13956v1) (V); [arXiv 2504.19413](https://arxiv.org/html/2504.19413v1) (V)

### Inferences

- MordomoOS's **valid_to supersession** matches the literature's better direction (Zep, Mem0g) and beats hard deletion. Zep, however, keeps **two** time axes, and MordomoOS appears to keep only one.
  - **Event time** (valid_from/valid_to): when the fact was true in the world.
  - **Record time** (created/expired): when the system learned or retracted it.
  - Without record time you cannot answer "what did I believe on date X" or audit a bad consolidation. Consider adding `recorded_at` / `retracted_at`.
- Supersession should be **scoped by overlap**. Zep invalidates only when time ranges overlap and the facts contradict. Facts that were true in different periods should coexist ("lived in Lisbon 2019-2023" next to "lives in Porto since 2023").
- MordomoOS's recall×importance×recency score resembles Generative Agents' scoring.
  - The literature uses recency **since last access**, so retrieval refreshes a memory. Check whether MordomoOS's "recency" means last-written or last-accessed.
  - Adding a **recall-count reinforcement** (MemoryBank) is consistent with its "recall" term.
- Decay in the literature mostly **demotes** memories rather than deleting them. Keep the journal as the non-lossy source and let MEMORY.md forget, which MordomoOS already does in principle.

### Gaps

- I found no controlled study comparing decay functions (exponential vs power-law vs heat) on a standard benchmark.
- No source gave quantified evidence that bi-temporal modelling alone improves scores, as an isolated ablation.
- How Letta's dreaming resolves conflicts (if at all beyond "merge duplicates") was not documented in the fetched snippets.

## Q4. Reflection: generating higher-level insights from raw memories, and evidence it helps

### Takeaway

Reflection, meaning periodic LLM synthesis of raw memories into higher-level insights that cite their evidence, originated with Generative Agents (2023). Its ablations show reflection contributes "critically" to believability. In 2025-2026 it reappears as sleep-time compute, Letta dreaming, A-MEM's memory evolution and Zep's community summaries. The strongest quantitative evidence comes from sleep-time compute (about 5x less test-time compute, up to +13-18% accuracy), but that was measured on math-reasoning tasks, not on personal memory.

### Cited Findings

- **Generative Agents**: ablation shows observation, planning and reflection "each contribute critically to the believability of agent behavior" — [arXiv 2304.03442](https://arxiv.org/abs/2304.03442) (V)
  - Reflections are triggered by an importance-sum threshold and formed by asking salient questions over recent memories. They cite evidence records and can recursively build on other reflections (a reflection tree) — [arXiv 2304.03442](https://arxiv.org/abs/2304.03442) (T)
  - The full paper reports a human-rated TrueSkill evaluation in which the full architecture beats the no-reflection, no-planning and no-observation ablations — [arXiv 2304.03442](https://arxiv.org/abs/2304.03442) (T; exact numbers not retrieved)
- **Sleep-time compute**: offline pre-computation over the context. About 5x less test-time compute for equal accuracy, up to +13% (Stateful GSM-Symbolic) and +18% (Stateful AIME) accuracy, 2.5x lower cost per query when amortized. Benefit scales with how predictable the query is — [arXiv 2504.13171](https://arxiv.org/abs/2504.13171) (V)
- **A-MEM memory evolution**: new notes trigger updates to existing notes' context and attributes, so the network "refines its understanding over time" — [arXiv 2502.12110](https://arxiv.org/abs/2502.12110) (V)
  - In Mem0's independent re-run, however, A-Mem scored lowest overall on LoCoMo (48.38 J) — [arXiv 2504.19413](https://arxiv.org/html/2504.19413v1) (V)
  - The Membox paper also re-implemented A-MEM and Mem0 locally (marked with \*) and got different numbers — [arXiv 2601.03785](https://arxiv.org/pdf/2601.03785) (S)
- **Zep community subgraph**: label-propagation clusters with map-reduce summaries act as a higher-level layer. They need periodic full refresh — [arXiv 2501.13956](https://arxiv.org/html/2501.13956v1) (V)
- **Letta**: reflection workflows are moving client-side, and dreaming runs on message-count or compaction triggers — [Letta next phase](https://www.letta.com/blog/our-next-phase) (S); [Letta docs](https://docs.letta.com/letta-agent/memory/index.md) (S)

### Inferences

- MordomoOS's nightly consolidation is a form of reflection. The literature suggests three upgrades:
  - **Event triggers** (importance-sum or message-count thresholds), not only a nightly schedule.
  - Reflections that **cite their source entries** (Generative Agents' evidence pointers), so they can be audited and invalidated when their sources are superseded.
  - Allowing **multi-level** insights: patterns over facts, not just a fact digest.
- Sleep-time results suggest the nightly pass should also **anticipate likely queries**: pre-compute answers or briefs for predictable needs such as the next day's agenda, open commitments and recurring questions. Sleep-time benefits are largest when queries are predictable, which daily-assistant use often is.
- Evidence that reflection improves **factual recall benchmarks** (LoCoMo, LongMemEval) is weak or mixed. A-MEM's evolution did not win in third-party re-runs. Treat reflection as useful for synthesis and anticipation, and keep raw retrieval for fact lookup.

### Gaps

- I found no benchmark that isolates "reflection on/off" for personal-assistant memory QA in 2024-2026.
- Exact TrueSkill numbers from Generative Agents were not retrieved.
- No evidence was found on how often reflections themselves hallucinate.

## Q5. Benchmarks: what they measure, scores reached, and which design choices drive gains

### Takeaway

The main benchmarks are:

- **LoCoMo**: very long multi-session dialogues; single-hop, multi-hop, open-domain and temporal questions.
- **LongMemEval**: 500 questions across 5 abilities, including knowledge updates and abstention.
- **MemoryAgentBench**: 4 competencies, including test-time learning and selective forgetting.
- **DMR**: too easy, effectively saturated.

Headline results are vendor-reported and contested. In the Mem0 paper, **full-context still had the best LoCoMo J score (72.9%)**, while memory systems traded 4-7 points of accuracy for about 90% lower latency and tokens. On LongMemEval_s, by contrast, Zep **beat** full-context (71.2% vs 60.2% with gpt-4o) at 1.6k vs 115k context tokens. The gains come mainly from structured extraction, temporal metadata, hybrid retrieval (semantic + BM25 + graph) and reranking. Temporal reasoning and knowledge updates remain the weakest categories.

### Cited Findings

**LongMemEval** (Wu et al., arXiv 2410.10813, Oct 2024)

- 500 questions testing five abilities: information extraction, multi-session reasoning, temporal reasoning, knowledge updates and abstention.
- Commercial assistants show about a **30% accuracy drop** across sustained interactions.
- Proposed optimizations:
  - **session decomposition** (finer value granularity),
  - **fact-augmented key expansion**,
  - **time-aware query expansion**.
- The abstract says these "greatly improve" recall and QA.
- [arXiv 2410.10813](https://arxiv.org/abs/2410.10813) (V; exact per-optimization gains not retrieved)

**Zep on LongMemEval_s** — [arXiv 2501.13956](https://arxiv.org/html/2501.13956v1) (V)

| Memory       | Model       | Score | Latency | Avg. context tokens |
| ------------ | ----------- | ----- | ------- | ------------------- |
| Full-context | gpt-4o-mini | 55.4% | 31.3 s  | 115k                |
| Zep          | gpt-4o-mini | 63.8% | 3.20 s  | 1.6k                |
| Full-context | gpt-4o      | 60.2% | 28.9 s  | 115k                |
| Zep          | gpt-4o      | 71.2% | 2.58 s  | 1.6k                |

- Relative gains: +15.2% (gpt-4o-mini) and +18.5% (gpt-4o).
- By question type, gpt-4o, full-context → Zep:

| Question type            | Full-context | Zep           |
| ------------------------ | ------------ | ------------- |
| Preference               | 20.0         | 56.7          |
| Temporal reasoning       | 45.1         | 62.4          |
| Multi-session            | 44.3         | 57.9          |
| Knowledge update         | 78.2         | 83.3          |
| Single-session-assistant | 94.6         | 80.4 (−17.7%) |

- The paper itself has inconsistencies, including a duplicated single-session-user row and an implausible 184% gain figure.

**DMR** (MemGPT's benchmark) — [arXiv 2501.13956](https://arxiv.org/html/2501.13956v1) (V)

- Zep 94.8% vs MemGPT 93.4% vs full-conversation 94.4% (gpt-4-turbo).
- With gpt-4o-mini: Zep 98.2%, full-conversation 98.0%.
- About 60 messages per conversation. The authors call DMR limited.

**LoCoMo, Mem0 paper** (LLM-as-Judge J; GPT-4o-mini) — [arXiv 2504.19413](https://arxiv.org/html/2504.19413v1) (V)

| Method                           | Overall J | p95 latency | Tokens |
| -------------------------------- | --------- | ----------- | ------ |
| Full-context                     | 72.90%    | 17.12 s     | 26,031 |
| Mem0g                            | 68.44%    | 2.59 s      | 3,616  |
| Mem0                             | 66.88%    | 1.44 s      | 1,764  |
| Zep                              | 65.99%    | 2.93 s      | 3,911  |
| Best RAG (k=2, 256-token chunks) | 60.97%    | —           | —      |
| LangMem                          | 58.10%    | 60.40 s     | —      |
| OpenAI memory                    | 52.90%    | —           | —      |
| A-Mem (re-run)                   | 48.38%    | —           | —      |

- Per category, best results: single-hop Mem0 67.13; multi-hop Mem0 51.15; open-domain Zep 76.60; temporal Mem0g 58.13.
- Mem0 claims +26% relative over OpenAI memory and 91% lower p95 latency / over 90% token savings versus full-context.

**Disputes**

- Letta and Zep say that, run correctly, both score about **10% higher than Mem0's best** on LoCoMo — [36kr](https://www.36kr.com/p/3423823155252610) (S, secondary)
- Memvid's benchmark page notes vendors dispute Mem0's figures — [Memvid](https://memvid.com/benchmarks) (S, competitor)
- Membox re-implemented Mem0 and A-MEM locally and got different numbers — [arXiv 2601.03785](https://arxiv.org/pdf/2601.03785) (S)

**Newer vendor and system claims**

- Mem0's research page now reports a **LoCoMo score of 92.5** (earlier cached 91.6) for a newer "token-efficient" algorithm — [Mem0 research](https://mem0.ai/research) (S, vendor self-report, not peer-reviewed)
- MIRIX reports **85.4% on LoCoMo** (85.38%; +8.0% over the best prior method) and +35% over RAG on ScreenshotVQA with 99.9% less storage — [arXiv 2507.07957](https://arxiv.org/abs/2507.07957v1) (S); [Lunadong](https://papers.lunadong.com/paper/7601) (S)
- MemoryOS reports +49.11% average F1 and +46.18% BLEU-1 over baselines on LoCoMo (GPT-4o-mini). The EMNLP version lists 48.36% F1 — [arXiv 2506.06326](https://arxiv.org/abs/2506.06326v1) (S); [ACL Anthology](https://aclanthology.org/people/ting-bai) (S)

**MemoryAgentBench** (Hu, Wang, McAuley, arXiv 2507.05257, v1 Jul 2025, v4 Jun 2026)

- Four competencies: **accurate retrieval, test-time learning, long-range understanding, selective forgetting**.
- Long-context datasets are recast as incremental multi-turn interactions.
- Finding: no method masters all four.
- [arXiv 2507.05257](https://arxiv.org/abs/2507.05257) (V; per-method scores not retrieved)

### Inferences

- LoCoMo numbers are **not comparable across papers**. Scores move from about 67% (Mem0 paper) to 85-92% (MIRIX, Mem0's later page) depending on judge prompt, model, category filtering (categories 1-4 only) and implementation.
- Prefer LongMemEval, which tests knowledge-update and abstention directly, and MemoryAgentBench, which tests selective forgetting. Both match MordomoOS's supersession features best.
- Design choices that drive gains across sources:
  - Fact extraction and reconciliation instead of raw chunks: Mem0 66.9 vs best RAG 61.0.
  - **Temporal metadata**: Mem0g's temporal gain; Zep's temporal reasoning 45.1 → 62.4.
  - **Hybrid retrieval with reranking** (Zep).
  - Finer-grained keys plus time-aware query expansion (LongMemEval).
- Known regression: fact-only memories **lose what the assistant itself said** (Zep single-session-assistant −17.7%). MordomoOS's journal should log assistant outputs and commitments, not just user facts. Recall should fall back to raw journal search for "what did you tell me" queries.
- MordomoOS's "4-layer deterministic recall" has no direct counterpart in the cited leaders. All of them use **semantic, hybrid and LLM-mediated retrieval**, often with rerankers. Deterministic recall gives predictability and testability. The literature implies it should at least include:
  - a BM25 or keyword layer,
  - an embedding layer,
  - time-aware query handling,
  - an abstention path ("I don't know"), which LongMemEval scores explicitly.
- A practical evaluation plan for MordomoOS is to run LongMemEval_s, which reports per-type scores, and track the **knowledge-update**, **temporal-reasoning** and **abstention** columns.

### Gaps

- Per-optimization gains from LongMemEval and per-method MemoryAgentBench scores were not retrieved.
- No neutral third-party leaderboard was found that runs Mem0, Zep, Letta, MIRIX and others under one harness.
- Letta's own LoCoMo numbers (its "filesystem agent" claim) were reported only secondhand.

## Q6. Reported failure modes: bloat, stale facts, hallucinated memories, injection via memory, privacy

### Takeaway

The best-documented failure modes are:

- **Memory poisoning or injection**: persistent across sessions, achievable with ordinary queries (MINJA), and listed in OWASP's 2026 Agentic Top 10 as ASI06.
- **Stale or contradicted facts**: temporal and knowledge-update categories stay weakest.
- **Bloat**: Zep's store exceeds 600k tokens for a 26k-token conversation, Claude Code's index is truncated at 200 lines, and Letta needs a defrag pass.

Hallucinated memories and privacy are widely discussed but less quantified in the sources collected.

### Cited Findings

- **MINJA** (NeurIPS 2025): the attacker uses only ordinary queries, with no access to the memory store. Steps:
  - An "indication prompt" induces the agent to store malicious reasoning and bridging steps.
  - The indication prompt is shortened progressively.
  - When a victim later asks a related question, the malicious records are retrieved as in-context demonstrations.
- MINJA reports injection success above **95%** and attack success above **70%** on GPT-4o-mini, Gemini 2.0 Flash and Llama 3.1 8B.
- [The Register](https://www.theregister.com/2025/03/11/minja_attack_poisons_ai_model_memory/) (S); [arXiv 2601.05504](https://arxiv.org/html/2601.05504v1) (S)
- A January 2026 study notes that MINJA's numbers came from idealized conditions, and that robustness in realistic deployments remains understudied. It also studies defenses — [arXiv 2601.05504](https://arxiv.org/html/2601.05504v1) (S)
- **MemoryGraft** (Dec 2025): malicious entries that pose as successful past experiences, injected through benign-looking content such as README files — [arXiv 2512.16962](https://arxiv.org/pdf/2512.16962.pdf) (S)
- OWASP's 2026 Agentic AI Top 10 lists **ASI06 Memory and Context Poisoning**. Unlike prompt injection, poisoning persists across sessions — [WorkOS](https://workos.com/blog/ai-agent-memory-poisoning) (S, secondary)
- **SpAIware** (ChatGPT memory exfiltration persistence) is mentioned by secondary sources, but no primary source was retrieved — [vectorize.io](https://vectorize.io/articles/ai-memory-poisoning) (S, unverified)
- **Bloat and footprint**: a Zep store is over 600k tokens per conversation, versus about 7k for Mem0 and 14k for Mem0g, against 26k raw — [arXiv 2504.19413](https://arxiv.org/html/2504.19413v1) (V)
  - Claude Code loads only the first 200 lines of MEMORY.md, reportedly silently — [morphllm](https://www.morphllm.com/claude-code-memory-files) (S)
  - Letta added a defragmentation subagent to split, merge and dedupe — [Letta docs](https://docs.letta.com/letta-agent/memory/index.md) (S)
- **Stale facts**:
  - LangMem scores 23.43 J and OpenAI memory 21.71 J on LoCoMo temporal questions — [arXiv 2504.19413](https://arxiv.org/html/2504.19413v1) (V)
  - Zep's knowledge-update score fell slightly with gpt-4o-mini (76.9 → 74.4) — [arXiv 2501.13956](https://arxiv.org/html/2501.13956v1) (V)
  - LongMemEval reports about a 30% drop for commercial assistants over sustained interactions — [arXiv 2410.10813](https://arxiv.org/abs/2410.10813) (V)
- **Lossy compression**: recursive summarization scores only 35.3% on DMR, versus 94.4% for full conversation (gpt-4-turbo) — [arXiv 2501.13956](https://arxiv.org/html/2501.13956v1) (V)
- **Privacy and controls**:
  - ChatGPT may save details "without you needing to ask"; users can delete individual memories or all of them, and Temporary Chat bypasses memory. Turning saved memory off does not erase stored memories — [OpenAI Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq) (S)
  - MIRIX separates a **Knowledge Vault** for sensitive data — [arXiv 2507.07957](https://arxiv.org/abs/2507.07957v1) (S)
  - Anthropic's memory tool keeps storage client-side, under developer control — [Anthropic](https://www.anthropic.com/news/context-management) (S)

### Inferences

- MordomoOS's nightly consolidation writes into an always-loaded MEMORY.md, which makes it a **high-value poisoning target**. One injected journal line, for example from a web page or email the agent read, could be promoted into durable memory. The literature suggests:
  - **provenance tags** on journal entries (user-said vs tool or web content vs agent-inferred),
  - refusing to promote untrusted-source content into MEMORY.md without confirmation,
  - keeping promoted facts linked to their source entries so a poisoned source can be invalidated in cascade.
- Recursive summarization's collapse on DMR (35.3%) warns against consolidations that **rewrite MEMORY.md wholesale** each night. Prefer incremental, operation-based edits (Mem0-style ADD/UPDATE/INVALIDATE/NOOP) with diffs, plus a versioned file (Letta uses git) for rollback.
- To control bloat, use a hard size budget on MEMORY.md (in the spirit of Claude Code's 200-line index), topic files below it, and a periodic dedupe or merge pass.

### Gaps

- No quantified rate of **hallucinated or false memories** created by LLM consolidation was found in 2024-2026 sources.
- No primary write-up of SpAIware was retrieved.
- No benchmark measuring privacy leakage from memory stores was found in this session.
