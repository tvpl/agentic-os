# Retrieval and Summarization for a Local-First Personal AI Second Brain (2024-2026)

Notes compiled 2026-10-29. "Fetched" means the source page was read this session. Items marked _(not re-fetched)_ come from well-known primary papers cited by URL. They were not re-read in this session, so the report writer should treat their figures as lower-confidence.

## 1. Hybrid retrieval: BM25 + dense, fusion, query handling, reranking

### Takeaway

The best-documented recipe for 2024-2025 runs BM25 and dense retrieval in parallel, fuses the two lists with rank fusion (RRF, k=60 is the de facto default), and then reranks a wide candidate pool (around 100-150) down to about 20 with a cross-encoder. Anthropic measured each stage adding a large step in recall. Query-rewriting tricks such as HyDE gave small gains in Anthropic's tests. Small local rerankers exist (0.3-0.6B), and the 2025 Qwen3-Reranker-0.6B clearly beats bge-reranker-v2-m3.

### Cited Findings

- Anthropic's recipe runs BM25 for exact-match results and embeddings for semantic results, then merges and deduplicates the two lists "using rank fusion" — [Anthropic, Contextual Retrieval, 2024-09-19](https://www.anthropic.com/news/contextual-retrieval)
- Measured retrieval failure rate (1 − recall@20), baseline 5.7%. The full stack (contextual embeddings + contextual BM25 + rerank) reaches 1.9%, a 67% reduction. Adding BM25 to contextual embeddings takes the failure rate from 3.7% to 2.9%. — [Anthropic, 2024-09-19](https://www.anthropic.com/news/contextual-retrieval)
- Rerank configuration: retrieve the top 150 candidates and have the reranker keep the top 20. Passing 20 chunks to the model outperformed passing 5 or 10. Anthropic used the Cohere reranker and did not test Voyage's. — [Anthropic, 2024-09-19](https://www.anthropic.com/news/contextual-retrieval)
- Anthropic also tried generic document summaries, hypothetical document embeddings (HyDE) and summary-based indexing. In their tests these "showed limited or low gains". — [Anthropic, 2024-09-19](https://www.anthropic.com/news/contextual-retrieval)
- HyDE (Gao et al., Dec 2022) has an LLM write a hypothetical answer document and embeds that document in place of the query, for zero-shot dense retrieval — [arXiv 2212.10496](https://arxiv.org/abs/2212.10496) _(not re-fetched)_
- A worked SQLite example of RRF over FTS5 + sqlite-vec uses `rrf_k = 60`, `weight_fts = 1.0` and `weight_vec = 1.0`, joining the two lists with a full outer join. Changing the weights shifts how much each list influences the ranking. The same post shows two alternatives: "keyword-first" (FTS results, then vector results via UNION ALL) and "FTS then re-rank by cosine". — [Alex Garcia, sqlite-vec hybrid search, 2024-10-02](https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/index.html)
- RRF's original paper (Cormack, Clarke & Büttcher, SIGIR 2009) introduced score = Σ 1/(k + rank) with k=60 — [RRF paper](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf) _(not re-fetched)_
- Local reranker comparison. All scores rerank the top 100 candidates from Qwen3-Embedding-0.6B (MTEB-R / MMTEB-R multilingual / MLDR long-doc):
  - bge-reranker-v2-m3 (0.6B): 57.03 / 58.36 / 59.51
  - jina-multilingual-reranker-v2-base (0.3B): 58.22 / 63.73 / 39.66
  - gte-multilingual-reranker-base (0.3B): 59.51 / 59.44 / 66.33
  - Qwen3-Reranker-0.6B: 65.80 / 66.36 / 67.28
  - Qwen3-Reranker-4B: 69.76 / 72.74 / 69.97
  - All Apache-2.0 per the card; paper dated 2025-06-05 — [Qwen3-Reranker-0.6B model card](https://huggingface.co/Qwen/Qwen3-Reranker-0.6B)
- bge-m3 (Jan 2024) outputs dense, sparse (lexical weights) and multi-vector (ColBERT-style) representations from one model, covering 100+ languages and inputs up to 8192 tokens. This makes a "hybrid in one model" option possible locally. — [arXiv 2402.03216](https://arxiv.org/abs/2402.03216) _(not re-fetched)_
- ColBERTv2 / PLAID late-interaction retrieval is an alternative to single-vector dense retrieval. It costs more storage because it keeps one vector per token. — [ColBERTv2 arXiv 2112.01488](https://arxiv.org/abs/2112.01488); [PLAID arXiv 2205.09707](https://arxiv.org/abs/2205.09707) _(not re-fetched)_

### Inferences

- In MordomoOS's UI search, strict AND-of-prefix-terms favors precision. It fails silently on paraphrases, extra words and morphological variants. The usual fix is an OR/BM25-ranked fallback when AND returns little, or always fusing an OR query with the AND query.
- MordomoOS's choice of RRF with k=60 matches common practice. Weighted RRF (as in the sqlite-vec example) is a cheap lever to tune the balance once an eval set exists.
- The biggest single gap vs the literature is the missing reranking stage. Anthropic's numbers show rerank as the step from 2.9% to 1.9% failure. A local Qwen3-Reranker-0.6B or bge-reranker-v2-m3 over the top 50-150 fused candidates is the closest offline equivalent. CPU latency would need measuring.
- Query rewriting/HyDE is low priority given Anthropic's "limited gains" finding. Cheap rule-based expansion is more promising for a personal knowledge base: accent folding for Portuguese, synonyms from the user's own tags, and time-aware expansion (see the LongMemEval findings in §6).

### Gaps

- No fetched source with measured CPU latency for cross-encoder rerankers (MiniLM-L6 ms-marco, bge-reranker) at, say, 50 candidates on a laptop.
- No fetched head-to-head of RRF vs weighted/convex score fusion on the same benchmark. The commonly cited Bruch et al. 2022 "fusion functions" analysis was not verified.
- ms-marco-MiniLM cross-encoder figures were not found this session.

## 2. Contextual Retrieval (Anthropic 2024), late chunking (Jina 2024), heading-based chunking

### Takeaway

Contextual Retrieval prepends a 50-100-token LLM-written "situating" blurb to each chunk before embedding and BM25 indexing. It cut top-20 failure by 35% (embeddings only), 49% (adding BM25) and 67% (adding rerank), at about $1.02 per million document tokens one-time with prompt caching. Late chunking gets some of the same effect at no LLM cost: it embeds the whole document, then pools per chunk, and needs no training.

### Cited Findings

- Contextual embeddings: failure 5.7% to 3.7% (−35%). Contextual embeddings + contextual BM25: 2.9% (−49%). With rerank: 1.9% (−67%). Metric is 1 − recall@20. — [Anthropic, 2024-09-19](https://www.anthropic.com/news/contextual-retrieval)
- Context per chunk is usually 50-100 tokens, generated by Claude 3 Haiku. Cost is $1.02 per million document tokens, assuming 800-token chunks, 8k-token documents and 100 tokens of context per chunk. Prompt caching cuts latency by more than 2x and cost by up to 90%. — [Anthropic, 2024-09-19](https://www.anthropic.com/news/contextual-retrieval)
- Gemini Text 004 and Voyage were the best embedding models in Anthropic's comparison — [Anthropic, 2024-09-19](https://www.anthropic.com/news/contextual-retrieval)
- Advice from the same post: if the knowledge base is under 200,000 tokens (~500 pages), put all of it in the prompt and skip RAG. Also: tune chunk size, boundaries and overlap; tailor the contextualizer prompt, e.g. with a glossary; keep context separate from chunk text at answer time; always run evals. — [Anthropic, 2024-09-19](https://www.anthropic.com/news/contextual-retrieval)
- Late chunking embeds all tokens of a long text with a long-context embedding model, then splits after the transformer and before mean pooling, so each chunk vector carries surrounding context. No extra training is needed; an optional fine-tune exists. Submitted 2024-09-07, revised 2025-07-07. The abstract claims "superior results across various retrieval tasks" without numbers. — [arXiv 2409.04701](https://arxiv.org/abs/2409.04701)
- In Brazilian Portuguese tax QA, raising bge-m3's input cap from 512 to 2048 tokens improved nDCG@10 by "nearly a quarter". MTEB-PT also reports that longer-context models do better on retrieval and reranking, so chunk/context length matters. — [MTEB-BR / MTEB-PT, arXiv 2607.04581 (HF paper page)](https://huggingface.co/papers/2607.04581.md); [MTEB-PT arXiv 2607.04071](https://arxiv.org/pdf/2607.04071)

### Inferences

- MordomoOS's "section scoring" already uses heading structure, which is a natural chunk boundary for Markdown notes. The cheap analogue of Contextual Retrieval is deterministic contextual headers: prepend file title, area and heading path ("Area > Note > H2 > H3") to each section before both FTS and embedding. It costs no LLM calls and captures part of the "situating" benefit. This is an inference; no fetched source measures the deterministic variant.
- With a local LLM, an optional background job could generate 50-100-token contexts per section, cached and regenerated only when the section's hash changes.
- Late chunking needs a long-context local embedder and access to token-level outputs. That is feasible with Qwen3-Embedding (32K) or bge-m3 (8K); EmbeddingGemma is capped at 2K. A plain HTTP embedding endpoint that returns pooled vectors cannot do late chunking.
- Many personal knowledge bases may stay under Anthropic's 200k-token "just include everything" threshold for a single area. Area-scoped full inclusion can beat retrieval when the model's context allows.

### Gaps

- No fetched figures for late chunking gains (the abstract gives none; the paper's tables were not read).
- No published measurement of heading-path prefixes vs LLM-generated contexts.

## 3. Local/offline embedding models (2025-2026), Portuguese support, SQLite vector options

### Takeaway

Two practical offline options are EmbeddingGemma-300m (308M params, 768d with Matryoshka down to 128d, sub-200MB RAM quantized, 2K context, 100+ languages, ranked 13th of 93 on Brazilian Portuguese MTEB) and Qwen3-Embedding-0.6B (32K context, MRL 32-1024d, Apache-2.0, MMTEB 64.33). For near-zero compute, model2vec static embeddings (potion-multilingual-128M, 256d, MIT) give about 91% of LaBSE quality. Any of these is far above a feature-hash vector. sqlite-vec stores vectors in a `vec0` virtual table next to FTS5 in one file.

### Cited Findings

- **EmbeddingGemma-300m** (Google; blog 2025-09-04, paper arXiv 2509.20354 dated 2025-09-24):
  - 308M params (~100M model + ~200M embedding params); 768d, MRL to 512/256/128; 2K token context; 100+ languages.
  - Under 200MB RAM with QAT; under 15ms per 256-token embedding on EdgeTPU.
  - Runs in sentence-transformers, llama.cpp, Ollama, transformers.js, MLX and LM Studio; works offline.
  - Google calls it the highest-ranking open multilingual model under 500M params on MTEB (publisher's claim).
  - Sources: [Google Developers Blog](https://developers.googleblog.com/en/introducing-embeddinggemma/); [HF model card](https://huggingface.co/google/embeddinggemma-300m)
- EmbeddingGemma MTEB scores (mean task):
  - Multilingual v2: 61.15 (768d), 60.71 (512d), 59.68 (256d), 58.23 (128d).
  - English v2: 69.67 at 768d.
  - Q4_0 quantized keeps 60.62 multilingual; Q8_0 keeps 60.93.
  - Prompts: query = `task: search result | query: {content}`; document = `title: {title|none} | text: {content}`. No float16 activations (use fp32 or bf16).
  - Source: [HF model card](https://huggingface.co/google/embeddinggemma-300m)
- **Qwen3-Embedding-0.6B** (paper 2025-06-05, Apache-2.0):
  - 28 layers, 32K context, output dims 32-1024 (MRL), instruction-aware, 100+ languages.
  - MMTEB 64.33 / 56.00 (task/type); MTEB Eng v2 70.70.
  - Comparators on the same card (MMTEB): bge-m3 59.56; multilingual-e5-large-instruct 63.22; Qwen3-Embedding-4B 69.45; 8B 70.58; Gemini Embedding 68.37.
  - Source: [HF model card](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)
- **Portuguese-specific evidence** (MTEB-BR/MTEB-PT, 2026; evaluation data June-July 2026):
  - 22 native Brazilian-Portuguese tasks, 93 models.
  - gemini-embedding-001 ranks 1st (mean 0.682); Qwen3-Embedding-8B 2nd (0.670), the top open model; the top six are statistically tied.
  - EmbeddingGemma-300m ranks 13th of 93, within 0.033 of the leader.
  - multilingual-e5-large-instruct ranks only 19th despite leading open models on MMTEB.
  - Multilingual rank vs Portuguese rank: Spearman ρ = 0.754 (95% CI 0.54-0.89). Llama-Embed-Nemotron-8B is 3rd on multilingual but 49th on PT.
  - Across open models, parameter count correlates with retrieval quality (ρ = +0.63), but a 0.3B model outranks several encoders above 5B.
  - Source: [arXiv 2607.04581 via HF papers](https://huggingface.co/papers/2607.04581.md)
- A separate MTEB-PT benchmark (14 datasets, 17 models) also finds that multilingual rankings do not reliably predict Portuguese performance — [arXiv 2607.04071](https://arxiv.org/pdf/2607.04071) (only the search snippet was read)
- **model2vec static embeddings:** potion-multilingual-128M is distilled from bge-m3, 256d, 101 languages (the page header says 102), MIT.
  - MTEB mean 47.31 vs LaBSE 52.07, i.e. 90.86% of LaBSE.
  - Described as "orders of magnitude faster on both GPU and CPU"; no exact multiplier is given.
  - Source: [HF model card](https://huggingface.co/minishlab/potion-multilingual-128M)
- **sqlite-vec:** a SQLite extension, MIT/Apache-2, with no server.
  - Vectors live in a `vec0` virtual table; KNN via `MATCH ... ORDER BY distance LIMIT k`; vectors inserted as JSON or BLOBs.
  - Runs on desktop, mobile, WASM and Raspberry Pi, with bindings for Python, Node, Go, Rust and Ruby. Version shown: v0.1.10-alpha.4.
  - Sources: [sqlite-vec docs](https://alexgarcia.xyz/sqlite-vec/)
- In the Oct 2024 hybrid post, FTS5 and sqlite-vec could not yet be filtered by metadata; partition/metadata filtering was "coming soon". The demo was small (14.5k headlines, 4.3MB). — [Alex Garcia, 2024-10-02](https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/index.html)

### Inferences

- MordomoOS's 256-dim signed feature-hash vector is essentially hashed bag-of-words. It captures lexical overlap, much like FTS, and adds little semantic recall: no synonyms, and no cross-lingual matching between PT and EN. Fusing it with FTS via RRF mostly re-weights lexical evidence. The literature's semantic gains come from trained models. Inference: this is not benchmarked in any fetched source.
- Plausible offline upgrade ladder, cheapest first:
  1. potion-multilingual-128M (static, 256d, same dimension as the current hash vector, CPU-trivial, MIT).
  2. EmbeddingGemma-300m at 256d or 768d (best quality-per-size for PT; Gemma license requires acceptance).
  3. Qwen3-Embedding-0.6B (Apache-2.0, long context, enables late chunking).
     Store the vectors in sqlite-vec alongside FTS5 to keep a single-file, local-first design.
- For Portuguese, prefer models validated on MTEB-PT/BR over MMTEB headline rank. The two rankings diverge (ρ ≈ 0.75).
- At personal scale (tens of thousands of sections), brute-force KNN in sqlite-vec is likely fine. MRL truncation (256d) or int8/binary storage would cut size further; the fetched pages do not document those types (see Gaps).

### Gaps

- No fetched CPU throughput numbers (embeddings/sec on a laptop CPU) for EmbeddingGemma, Qwen3-0.6B or potion.
- No fetched current sqlite-vec docs on int8/bit vectors, metadata columns, or brute-force latency at N vectors. The docs landing page did not cover them.
- nomic-embed-text v1.5/v2 and multilingual-e5-small/base were not checked this session. MTEB-BR places multilingual-e5-large-instruct 19th.
- The exact Portuguese retrieval-only ranks for small models were not extracted from MTEB-BR.

## 4. Summarizing a growing knowledge base: RAPTOR, hierarchical, GraphRAG, progressive, incremental, router/index files

### Takeaway

Hierarchical summary layers help "global" or multi-hop questions: RAPTOR gave +20 points absolute on QuALITY with GPT-4, and GraphRAG targets corpus-wide sensemaking. Their main cost is LLM summarization at index time and staleness when sources change. Microsoft's LazyGraphRAG (Nov 2024) skips index-time summaries entirely: it defers LLM use to query time at 0.1% of GraphRAG's indexing cost. That is a strong argument for cheap, deterministic, regenerable index/router files plus query-time summarization in a single-user system.

### Cited Findings

- RAPTOR (2024-01-31) recursively embeds, clusters and summarizes chunks bottom-up into a tree with "differing levels of summarization". With GPT-4 it improved the best QuALITY result by 20% absolute accuracy. — [arXiv 2401.18059](https://arxiv.org/abs/2401.18059)
- GraphRAG (Apr 2024) builds an entity graph, detects communities and pre-summarizes each community with an LLM, to answer "global" questions over a corpus — [arXiv 2404.16130](https://arxiv.org/abs/2404.16130) _(not re-fetched)_
- LazyGraphRAG (2024-11-25):
  - Indexing cost equals vector RAG's and is "0.1% of the costs of full GraphRAG". It uses NLP noun-phrase extraction plus graph statistics, with no LLM summarization.
  - It matches GraphRAG Global Search quality on global queries at more than 700x lower query cost.
  - At 4% of global-search query cost it beats all compared methods on both local and global queries.
  - It avoids "up-front indexing costs that may be prohibitive".
  - Source: [Microsoft Research blog](https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/)
- Anthropic found that generic document summaries and summary-based indexing gave limited gains for chunk retrieval in their tests — [Anthropic, 2024-09-19](https://www.anthropic.com/news/contextual-retrieval)
- Progressive Summarization (Tiago Forte) layers emphasis inside the note itself: L1 the captured note, L2 bold, L3 highlight, L4 a short executive summary, L5 remix. It is applied incrementally "opportunistically" each time a note is revisited. — [Forte Labs](https://fortelabs.com/blog/progressive-summarization-a-practical-technique-for-designing-discoverable-notes/) _(not re-fetched; original 2017, a pre-2024 practitioner source)_
- llms.txt (proposed Sept 2024) is a Markdown file at a site root giving an LLM-readable summary and curated links — a navigational summary layer — [llmstxt.org](https://llmstxt.org/) _(not re-fetched)_
- AGENTS.md is a convention for an agent-facing README/map file in repositories — [agents.md](https://agents.md/) _(not re-fetched)_
- Claude Code loads CLAUDE.md "naively ... into context up front" as its pre-loaded navigational layer, and uses glob/grep for everything else — [Anthropic, Effective context engineering, 2025-09-29](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

### Inferences

- MordomoOS's generated ROUTER.md plus per-area index files is the same pattern as llms.txt, AGENTS.md and CLAUDE.md: a cheap top layer of a summary tree. It is aligned with the LazyGraphRAG insight of avoiding expensive LLM summaries at index time.
- Gaps vs the literature:
  - (a) No intermediate abstractive layer, such as per-area "what this area currently says" summaries in the RAPTOR style. Those help multi-note or global questions.
  - (b) No explicit staleness model. Summaries should record the source hashes/mtimes they were built from, be marked stale when any source changes, and be regenerated lazily (on read) or in the background. This is an inference; no fetched source measures staleness strategies.
  - (c) Summaries could themselves be indexed (RAPTOR "collapsed tree" style), so retrieval can hit either a leaf section or an area summary.
- Rolling/incremental summaries (update the summary with the diff rather than re-summarizing everything) are standard practice in agent memory, but no fetched source measures them for knowledge bases.

### Gaps

- RAPTOR's clustering method (the paper uses GMM with UMAP; _not verified_ this session) and its collapsed-tree vs traversal results were not extracted.
- No fetched quantitative study of summary staleness or incremental re-summarization for changing personal notes.
- GraphRAG's absolute indexing cost figures were not fetched; only the relative 0.1% figure from Microsoft.

## 5. Context engineering for agents (2025): just-in-time vs pre-loaded, agentic search vs vector RAG, compaction

### Takeaway

Anthropic's 2025 guidance favors a hybrid. Pre-load a small navigational layer (CLAUDE.md), keep "lightweight identifiers" such as paths and links, and load content just-in-time with tools (glob/grep). Treat context as a finite "attention budget" subject to context rot, and use compaction, note-taking and sub-agents (returning 1-2k-token summaries) for long tasks. Claude Code reportedly dropped a local vector DB for agentic grep search. That finding is specific to code and not a controlled benchmark.

### Cited Findings

- Context is finite with diminishing returns ("attention budget"). As context grows, "the model's ability to accurately recall information from that context decreases" (context rot), since n tokens create n² pairwise relationships. — [Anthropic, 2025-09-29](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Just-in-time agents "maintain lightweight identifiers" and load data at runtime. Runtime exploration is slower than retrieving pre-computed data, so a hybrid is recommended: some data up front, the rest explored as needed. Claude Code drops CLAUDE.md in up front and uses glob/grep to navigate. — [Anthropic, 2025-09-29](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Compaction summarizes a conversation near the context limit, keeping decisions, unresolved bugs and implementation details and dropping redundant tool output. Clearing old tool results is the lightest form. — [Anthropic, 2025-09-29](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Structured note-taking (NOTES.md, to-do lists, the memory tool) persists state outside the window. Sub-agents return "condensed, distilled" summaries of often 1,000-2,000 tokens after using tens of thousands of tokens exploring. — [Anthropic, 2025-09-29](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Boris Cherny (Claude Code) said early versions used RAG with a local vector DB, but agentic search "generally worked better". The reasons he gave were security (not sending code to third-party embedding services), keeping an index in sync, and the trade of latency and tokens for simplicity. — [OfficeChai summary](https://officechai.com/ai/claude-researcher-explains-how-agentic-search-performed-better-than-rag-for-code-generation/) (secondary source; the primary X post and Latent Space podcast were not verified)
- A 2026 AI Engineer Europe talk ("RAG is dead, right?") notes its traces are illustrative, not a controlled benchmark. Commentary argues semantic indexes still win for concept search, huge repos and non-code knowledge. — [AI Engineer Europe 2026](https://www.ai.engineer/talks/UM6sFg_jdlE-rag-is-dead-right-kuba-rogut); [SmartScope](https://smartscope.blog/en/ai-development/practices/rag-debate-agentic-search-code-exploration/) (secondary sources)

### Inferences

- MordomoOS's recall pipeline already does the hybrid Anthropic describes: a ROUTER.md pre-loaded layer, plus keyword FTS and one-level pointer following as a mini "just-in-time" step. A natural extension is letting the agent iterate: more than one hop, and reformulating queries after reading results. Anthropic describes this as agentic search.
- Personal notes are natural language, mixed PT/EN, with synonyms and paraphrase. That is closer to the "non-code knowledge" case where semantic retrieval keeps value than to code, where identifiers make grep strong. The Claude Code result should not be over-generalized to a second brain.
- The recall pipeline should enforce a token budget, for example by returning section snippets plus identifiers rather than full files. That matches the "lightweight identifiers" guidance.

### Gaps

- No primary-source quantitative comparison of grep-style agentic search vs vector RAG on personal or prose knowledge bases was found.
- Exact Claude Code compaction thresholds and token numbers were not given in the fetched post.

## 6. Evaluation: small personal eval sets, recall@k / MRR, BEIR, LongMemEval

### Takeaway

Use Anthropic's metric, 1 − recall@20, to track retrieval failure, plus MRR/nDCG@10 for ranking quality, over a small hand-labelled set of real queries and the notes that should answer them. LongMemEval (500 questions; five abilities: extraction, multi-session, temporal, knowledge updates, abstention) is the closest public benchmark to a personal memory. Its proposed fixes (finer-grained values, fact-augmented keys, time-aware query expansion) map directly onto a second-brain index.

### Cited Findings

- Anthropic evaluated retrieval as 1 − recall@20, the share of relevant chunks not in the top 20, and advises "always run evals" — [Anthropic, 2024-09-19](https://www.anthropic.com/news/contextual-retrieval)
- LongMemEval (2024-10-14, rev. 2025-03-04):
  - 500 curated questions embedded in scalable chat histories, testing information extraction, multi-session reasoning, temporal reasoning, knowledge updates and abstention.
  - Commercial assistants and long-context LLMs show a ~30% accuracy drop over sustained interactions.
  - Proposed fixes: session decomposition (value granularity), fact-augmented key expansion (indexing) and time-aware query expansion. The abstract says these "greatly improve" recall but gives no numbers.
  - Source: [arXiv 2410.10813](https://arxiv.org/abs/2410.10813)
- BEIR (2021): 18 heterogeneous zero-shot retrieval datasets, on which BM25 is a strong, robust baseline vs many dense retrievers; nDCG@10 is the standard metric — [arXiv 2104.08663](https://arxiv.org/abs/2104.08663) _(not re-fetched; pre-2024)_
- MTEB-BR/PT (2026) offers Portuguese retrieval tasks for picking a model, and shows that multilingual leaderboard rank only moderately predicts PT rank (ρ = 0.754) — [arXiv 2607.04581](https://huggingface.co/papers/2607.04581.md)

### Inferences

- A practical personal eval: 50-200 queries collected from real usage (UI searches and agent recall calls), each labelled with 1-3 gold note/section IDs. Cover the LongMemEval categories: plain lookup, multi-note, "latest value" or knowledge update, time-scoped ("what did I decide in March"), and abstention (no answer exists). Include PT, EN and mixed queries, plus accent-less variants.
- Compute recall@5/@20 and MRR for each pipeline variant: AND-FTS, OR-BM25, + vector, + rerank, + heading prefixes. That gives MordomoOS a measured basis for each change, as Anthropic did.
- Knowledge-update and temporal questions suggest row signals for recency and supersession (newer note overrides older). MordomoOS's "row signals" may cover part of this, but that is not verified here.

### Gaps

- No fetched guidance on minimum eval-set size for statistically meaningful differences at personal scale.
- LongMemEval's per-optimization gain numbers were not extracted (only the abstract was read).

## 7. Gaps of MordomoOS vs the literature (synthesis)

### Takeaway

MordomoOS has the right skeleton: lexical FTS, RRF k=60 fusion, structural section scoring, pointer following, and a router/index summary layer. It lacks three of the stages with the largest measured gains: a real semantic embedder, a reranker, and chunk contextualization. It also lacks summary staleness tracking and a retrieval eval set.

### Cited Findings

- Stage gains on the same benchmark: contextual embeddings −35%, + contextual BM25 −49%, + rerank −67% failure — [Anthropic, 2024-09-19](https://www.anthropic.com/news/contextual-retrieval)
- RRF with k=60 and per-list weights is directly implementable in SQLite with FTS5 + sqlite-vec — [Alex Garcia, 2024-10-02](https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/index.html)
- Small offline embedders with strong Portuguese results exist: EmbeddingGemma-300m is 13th of 93 on MTEB-BR — [arXiv 2607.04581](https://huggingface.co/papers/2607.04581.md)
- Small offline rerankers: Qwen3-Reranker-0.6B scores MMTEB-R 66.36 vs bge-reranker-v2-m3 58.36 — [Qwen3-Reranker card](https://huggingface.co/Qwen/Qwen3-Reranker-0.6B)
- Index-time LLM summaries are expensive; deferring them can cut indexing cost to 0.1% of GraphRAG's — [Microsoft Research, 2024-11-25](https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/)

### Inferences

Prioritized list of gaps (all inferences from the findings above):

1. **Strict AND UI search.** It has no fallback to OR/BM25 ranking, no accent/diacritic folding (FTS5 `unicode61 remove_diacritics` can do this), and no PT stemming. This is likely the largest user-visible recall loss for Portuguese.
2. **The hash vector is not semantic.** Replace or augment it with a local model (potion-multilingual-128M, then EmbeddingGemma or Qwen3-Embedding-0.6B) stored in sqlite-vec. Keep the HTTP endpoint as optional.
3. **No reranker.** Add an optional local cross-encoder over the top 50-150 fused candidates.
4. **No contextualized chunks.** Prefix each section with its heading path and note/area title before indexing, in both FTS and vectors. Optionally add LLM-generated contexts cached by content hash.
5. **Summary layer is navigational only.** Consider per-area abstractive summaries (RAPTOR-like, one or two levels) generated lazily, with source-hash staleness flags, and index them for retrieval too.
6. **Pointer following is one-level.** Allow iterative agentic hops under a token budget, with the agent reformulating queries.
7. **No eval harness.** Build a recall@k/MRR set with LongMemEval-style categories, including PT queries.
8. **Full-context shortcut.** For small areas (under ~200k tokens), loading the whole area may beat retrieval, per Anthropic.

### Gaps

- MordomoOS internals (exact tokenizer, row signals, section scoring formula) were not inspected in the codebase for this note. The comparison relies on the description in the assignment.
- No fetched benchmark directly compares feature-hash vectors with trained embedders.
