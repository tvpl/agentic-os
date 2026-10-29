# How a second brain should be displayed and how it should help a person think (tools-for-thought and PKM interface research, 2024-2026)

Scope note: 20 search/fetch calls. The strongest evidence is the 2025 HCI work on AI and critical thinking (Microsoft Research/CMU at CHI 2025, Drosos et al. 2025, MIT Media Lab 2025) and primary product docs on memory controls (OpenAI, Anthropic). The evidence on graph views and canvases comes almost entirely from practitioners (forums, blogs). I found no controlled study showing that global graph views help people think. Comparison target: MordomoOS has a canvas force-directed "constellation" of up to 3000 most-recently-modified files (markdown-link, same-dir, same-area and related edges), a preview panel with backlinks and broken links, a Markdown editor dialog, a Today screen, search-as-you-type capped at 8 hits, and timeline playback.

## 1. Graph views, local graphs, clustering, semantic maps, timelines, spatial canvases: what is useful, and what are the performance limits?

### Takeaway

Practitioners broadly agree that the default global graph is hard to navigate once a vault grows. It is good for maintenance diagnostics (orphans, stale clusters, sync duplicates) and for a look at how mature an idea is. It does not work as a primary navigation surface. Value comes from filtering, scoping to a local neighbourhood, and treating edge types differently. Canvases help people make sense of material because the user places items spatially, but they slow down at a few hundred cards. A naive force-directed layout on Canvas2D hits its limits at a few thousand nodes.

### Cited Findings

- Zettelkasten forum users say graph views help young knowledge bases, but the network becomes "much more complex and dense" as the base matures. Others defend the view because Obsidian lets you localize it and choose how many hops to show (forum threads, undated, roughly 2020-2022). Sources: [Zettelkasten Forum](https://forum.zettelkasten.de/discussion/comment/16713), [Zettelkasten Forum](https://forum.zettelkasten.de/discussion/comment/16703/), [Zettelkasten Forum, older Zettelkastens](https://forum.zettelkasten.de/discussion/comment/16771).
- One critique says the core problem is that Obsidian's graph "treats all connections equally by default". The hairball "isn't broken; it's just showing you more information than any human can possibly parse visually." This article was seen only as a search snippet; the page now returns 404. Source: [digitalbiztalk (snippet, page 404)](https://digitalbiztalk.com/article/when-your-obsidian-graph-view-becomes-unusable-a-15k-note-reality-check).
- An article titled "Obsidian's Graph View Is Beautiful and Almost Completely Useless" calls the graph mostly decorative for navigation. This is weak evidence: the site sells merchandise, and its claimed "r/ObsidianMD consensus" is its own assertion. Source: [codeculture.store](https://codeculture.store/blogs/developer-culture/obsidian-graph-view-useful).
- Eleanor Konik's defence (Sep 10, 2021) lists concrete uses, all diagnostic or maturity checks rather than navigation:
  - Orphans at the edge mean her indexes or maps of content (MOCs) are out of date.
  - Floating dots point to folders she hasn't touched lately.
  - Sync errors show up as duplicate notes.
  - Filtering by Johnny Decimal number isolates the links between atomic notes and her outputs.
  - A work-in-progress article with few links means "concept needs development"; dense clusters mean it is "ready if a deadline arises".
  - She hovers over a node's neighbours to find unused ideas.
  - She does not use the local graph herself, but says most people she knows do.

  Source: [Eleanor Konik](https://www.eleanorkonik.com/its-not-just-a-pretty-gimmick-in-defense-of-obsidians-graph-view).

- Community alternatives to the default graph are Breadcrumbs (typed hierarchy), Juggl and ExcaliBrain (structured neighbourhood layouts). Source: [Zettelkasten Forum](https://forum.zettelkasten.de/discussion/comment/8741/).
- In NotebookLM, a mind map is generated per notebook and acts as a topic hierarchy for navigation, not as a link graph. It launched in March 2025 and can be downloaded as an image. Reports say it shows topics and helps users "spot connections". Sources: [9to5Google, Mar 27 2025](https://9to5google.com/2025/03/27/notebooklm-mind-map/), [TechRadar](https://www.techradar.com/computing/artificial-intelligence/googles-notebooklm-adds-mind-maps-to-its-string-of-research-tools-to-help-you-learn-faster-than-ever), [AlternativeTo, Mar 2025](https://alternativeto.net/news/2025/3/google-notebooklm-adds-new-interactive-mind-map-tool-and-multilingual-support).
- Research on spatial hypertext and analysts at large displays found that users encode meaning in spatial arrangement, for example by grouping relevant documents. That work led to the Analyst's Workspace, where analysts define relationships by placing documents freely. Sources: [UCL discovery PDF](https://discovery-pp.ucl.ac.uk/id/eprint/14803/1/14803.pdf), [Middlesex repository PDF](https://mdx-repository.prod-uk.cayuse.com/download/d8b3438d7f5e104738b303403182c9db31c9b00b11af59cb94e329d230afc269/2422811/merged_document_3.pdf).
- Practitioners argue that Obsidian Canvas is a thinking space, not a diagram tool. Sources: [goryugo, "Obsidian Canvas Is Not for Making Diagrams"](https://goryugo.com/en/obsidian-canvas/), [dsebastien notes on Obsidian Canvas](https://notes.dsebastien.net/30+Areas/33+Permanent+notes/33.02+Content/Obsidian+Canvas).
- Heptabase is built around infinite whiteboards of cards. A competitor's comparison page says Heptabase's own help docs report noticeable lag at around 100-150+ cards per whiteboard. This is second-hand from a competitor, so treat it with caution. Sources: [Capacities vs Heptabase](https://capacities.io/compare/heptabase), [hjarni vs heptabase](https://hjarni.com/compare/hjarni-vs-heptabase).
- Kinopio is a spatial canvas of cards, connection lines, boxes and lists. Its free tier allows 100 cards without an account. Source: [Kinopio llms.txt](https://kinopio.club/llms.txt).
- Rendering limits:
  - A library comparison found Canvas performance "reaches the limit at 5k nodes and 5k edges", while WebGL stayed usable to about 10k nodes and 11k edges. The tests were small and did not include Cosmograph. Source: [DEV Community, timlrx](https://dev.to/timlrx/a-comparison-of-javascript-graph-network-visualisation-libraries-34a8).
  - Sigma.js renders with WebGL and uses quad-tree label placement. Its v4 docs claim smooth performance at "tens of thousands" of nodes and edges. Source: [sigma.js v4 rendering docs](https://v4.sigmajs.org/concepts/rendering/).
  - Cosmograph calls itself the "fastest web-based library for large network graph visualization", built on WebGL. This is a vendor claim with no benchmark on the page. Source: [Cosmograph docs](https://classic.cosmograph.app/docs/cosmograph/Introduction).
  - knogin.com pages claim 100k nodes at 30-60 fps for Sigma. These look like marketing with no methodology; I treat them as unreliable. Source: [knogin](https://knogin.com/en/developers/sigma-large-graph-rendering).

### Inferences

- MordomoOS constellation, issue 1: it is a global hairball by design. 3000 nodes with four edge types, all drawn at once, is exactly the situation the critiques describe. Recommended changes:
  - Make the default view a local graph of 1-2 hops around the selected or open note.
  - Add edge-type toggles. Show only explicit markdown links by default, and treat same-dir and same-area as grouping (hulls or colour) rather than edges.
  - Render "related" (semantic) edges as dashed and on demand.
- MordomoOS constellation, issue 2: Canvas2D with 3000 nodes plus many edges sits near or above the roughly 5k-element Canvas limit reported above. Options: move to WebGL (sigma.js or cosmos/cosmograph), precompute the layout once, or render clusters as aggregate nodes.
- Choosing the 3000 most recently modified files biases the view toward recency and hides old, high-centrality hub notes. A "most connected" or "MOC/hub" selection mode would be more structurally honest.
- The best evidence-backed graph uses are diagnostic. A "graph health" overlay would match how power users actually use graphs: orphans, broken links (which MordomoOS already computes), clusters with no recent activity, and notes with high in-degree but no MOC.
- Timeline playback has no supporting evidence in what I found. Treat it as an engagement or delight feature, not a thinking aid, unless it supports "what changed in area X this week" queries.

### Gaps

- No peer-reviewed study 2024-2026 measures whether PKM graph views (global or local) improve recall, insight or navigation. All evidence found is from practitioners.
- No primary source found on UMAP/embedding-projection "semantic maps" in PKM products. I did not verify Obsidian plugins or products that do this.
- Heptabase's own documentation on whiteboard card limits was not fetched; the 100-150 card figure is second-hand.
- No head-to-head Cosmograph vs sigma.js benchmark was found.
- Scrintal and Obsidian Canvas performance limits were not found.

## 2. Interfaces of current AI PKM products (2024-2026) and which features stick

### Takeaway

The products that lead the field have moved toward:

- semantic related notes in a sidebar (Obsidian Smart Connections, the most-downloaded AI plugin);
- source-grounded synthesis with inline citations and generated artefacts such as mind maps, audio, video and reports (NotebookLM);
- structured objects plus AI credits (Tana);
- background resurfacing of past material (Readwise).

I could verify only some product claims in this pass. Several products (Mem, Reflect, Capacities, Logseq, Khoj, Recall, Granola, Limitless) remain gaps.

### Cited Findings

- Smart Connections (Brian Petro):
  - It embeds the vault locally and shows a sidebar Connections view of semantically related notes, plus a Lookup view for semantic search.
  - It ranks notes by cosine similarity between note embeddings.
  - A built-in local model means no API key is needed; Ollama is also supported.
  - Pro adds inline and footer connections.
  - About 959k downloads are listed.

  Sources: [Obsidian community: Smart Connections](https://community.obsidian.md/plugins/smart-connections), [obsidianstats](https://obsidianstats.com/plugins/smart-connections), [docs](https://docsearch.algolia.com/mcp/docs/repo/brianpetro/obsidian-smart-connections).

- The same "related notes" pattern recurs across many plugins:
  - Open Connections: auto-updates on file open; local Transformers.js embeddings.
  - Smart Related Notes: left sidebar; small multilingual local model.
  - Semantic Backlinks: a Related Notes panel plus inline link suggestions while typing.
  - Smart Linker: automatically inserts related links.

  Sources: [Open Connections](https://community.obsidian.md/plugins/open-connections), [Smart Related Notes](https://community.obsidian.md/plugins/smart-related-notes), [Semantic Backlinks](https://community.obsidian.md/plugins/semantic-backlinks), [Smart Linker](https://community.obsidian.md/plugins/smart-linker).

- NotebookLM timeline:
  - March 2025: Mind Maps added, free and paid tiers. Saved chat notes keep citations. Users can choose which sources feed generated outputs (study guides, FAQs, mind maps, audio overviews). Sources: [9to5Google](https://9to5google.com/2025/03/27/notebooklm-mind-map/), [UF Business Library guide](https://businesslibrary.uflib.ufl.edu/notebook-llm_revised).
  - April 2025: "Discover sources" listed. Source: [AlternativeTo NotebookLM news](https://alternativeto.net/software/notebook-lm/news/?p=2).
  - July 29, 2025: Video Overviews (narrated slides) rolled out, and the Studio panel was redesigned with four tiles (Audio Overview, Video Overview, Mind Map, Reports). Multiple outputs of the same type can be stored per notebook. Source: [TechCrunch, Jul 29 2025](https://techcrunch.com/2025/07/29/googles-notebooklm-rolls-out-video-overviews).
- Tana, according to its own release notes:
  - October 2025: a side-by-side "List" navigation view that pairs a list panel with a detail panel; the classic view was renamed "Outline". Source: [Tana releases 2025 wk 41-43](https://tana.inc/releases/2025-wk-41-43).
  - Free tier: 500 AI credits per month covering transcription, AI chat and mobile voice memos. Sources: [Tana releases](https://tana.inc/releases/2025-wk-41-43), [Tana blog 2024-2025 recap](https://outliner.tana.inc/blog/what-new-in-tana-2024-2025).
- Readwise resurfaces highlights through a daily email and in-app review using spaced repetition and active recall. Users configure how many items and when. Highlights can be turned into flashcards. A user says it reminds them of highlights "just when I'm working on related projects". Sources: [Readwise App Store listing](https://apps.apple.com/us/app/-/id1476885528), [DEV: Readwise + Obsidian](https://dev.to/airabbit/mastering-knowledge-retention-with-readwise-and-obsidian-3cbn).
- Maggie Appleton (who leads design at Elicit) argues chat is rarely a suitable interface. Her Language Model Sketchbook prototypes three alternatives:
  - "Daemons": background personas that suggest revisions, challenge claims and offer ideas while you write.
  - "Branches": explore causes and consequences.
  - "Epi": a right-click reasoning assistant for research writing.

  The post is undated ("planted over 3 years ago", so roughly 2023). Sources: [Maggie Appleton, LM Sketchbook](https://maggieappleton.com/lm-sketchbook), [Antoine Buteau summary](https://www.antoinebuteau.com/lessons-from-maggie-appleton/).

- Appleton's digital-garden framing favours "topology over chronology", meaning associative links and context. Source: [Antoine Buteau, lessons from Maggie Appleton](https://www.antoinebuteau.com/lessons-from-maggie-appleton/).

### Inferences

- Patterns that stick across products, partly verified: daily notes, a backlinks panel, a related (semantic) notes sidebar, scheduled resurfacing, and source-grounded generated overviews.
- MordomoOS already has backlinks and broken links in the preview, plus a Today screen. Its clearest gaps:
  - no semantic "related notes" sidebar, even though "related" edges exist in the graph, they are not exposed next to the reading pane;
  - no unlinked-mentions panel;
  - no resurfacing or review queue;
  - no generated, cited overview of an area or folder.
- Search capped at 8 hits as you type is fine for quick open, but there should be a "see all results" full search view with snippets, filters (area, date, type) and a semantic mode. Otherwise search cannot be used for exploration.
- A Markdown editor in a dialog is a weak spot. The related-notes sidebar and inline link suggestions work best while writing, which a modal editor discourages. Appleton's daemons and Semantic Backlinks' suggest-while-typing both assume a persistent editor with a side panel.
- NotebookLM's "pick which sources feed this output" control is a cheap, high-trust pattern. Letting the user scope an AI synthesis to a folder, area or selection is a direct analogue.

### Gaps

- Not verified in this pass (no source fetched):
  - Mem.ai: current interface and "Mem 2.0" pivot.
  - Reflect: backlinks plus AI.
  - Capacities: object types.
  - Logseq: DB version status.
  - Notion AI: 2025 features (AI meeting notes, research mode).
  - Khoj, Recall.ai, Granola (meeting-notes UI), Limitless (pendant; reported acquisition).
  - Heptabase AI features.
  - Obsidian Copilot.

  These need primary changelogs.

- No usage or retention data showing which PKM features "stick". Claims about daily notes and backlinks are practitioner consensus, not measured in sources found.
- No evidence found for "on this day" features in Reflect or Mem.

## 3. AI that helps thinking, and the cognitive-offloading and over-reliance evidence

### Takeaway

The 2025 evidence base consistently warns that fluent AI answers reduce people's critical engagement, especially when trust in the AI is high, the task is routine or time is short. It also shows this can be partly counteracted by interaction design:

- ask for the user's reasoning first ("ExtendAI");
- attach short, specific critiques ("provocations") to AI suggestions;
- use multi-perspective agents;
- use reflection prompts that escalate with context.

Design for "help me think for myself", not for ready-made answers.

### Cited Findings

- Lee et al. (Microsoft Research and CMU), "The Impact of Generative AI on Critical Thinking", CHI 2025, DOI 10.1145/3706598.3713778:
  - Survey of 319 knowledge workers covering 936 real use cases.
  - Higher confidence in GenAI went with less critical thinking; higher self-confidence went with more, at a perceived higher cognitive cost.
  - Effort dropped on routine, low-stakes, time-pressured tasks and rose on high-stakes ones.
  - Critical thinking shifts toward information verification, response integration and task stewardship.
  - Barriers: low awareness that output needs checking, low motivation, and difficulty refining prompts in unfamiliar domains.
  - Recommendations: proactive prompts, reasoning explanations, guided critiques, and AI as a "provocateur".

  It is self-report (Prolific). Sources: [Microsoft Research Tools for Thought at CHI 2025](https://www.microsoft.com/en-us/research/?p=1136647), [Microsoft Research paper page](https://www.microsoft.com/en-us/research/?p=1135061), [The Register, Feb 11 2025](https://www.theregister.com/2025/02/11/microsoft_study_ai_critical_thinking/).

- "AI, Help Me Think—but for Myself" (Microsoft and UCL, CHI 2025) compared two assistants on a financial decision task (formative n=10, comparative n=21):
  - RecommendAI gave recommendations. It sparked new directions but felt disconnected from the user's reasoning, like a "black box".
  - ExtendAI asked users to write their reasoning first and then gave feedback. It produced deeper reflection and kept users in control, but its feedback could be too generic and could echo users' views, reinforcing bias.

  Source: [Microsoft Research CHI 2025 summary](https://www.microsoft.com/en-us/research/?p=1136647).

- "Are We On Track?" (CHI 2025, n=15) tested goal reflection during meetings:
  - Passive: an ambient visualization showing how topics relate to the meeting's goals.
  - Active: interactive questions.

  Active prompts changed team behaviour more (for example, agendas changed); passive cues supported individual thinking. Interventions should escalate or de-escalate, with thresholds the team can customize. Source: [Microsoft Research CHI 2025](https://www.microsoft.com/en-us/research/?p=1136647).

- "YES AND" (CHI 2025): persona agents with different expertise take turns based on confidence, ask clarifying questions and build on ideas, to reduce groupthink. A "Sage" agent summarizes, and the user writes the final approach. Source: [Microsoft Research CHI 2025](https://www.microsoft.com/en-us/research/?p=1136647).
- Sarkar et al., "When Copilot Becomes Autopilot" (EuSpRIG 2024, arXiv 2412.15030), argue AI should act as a provocateur as well as an assistant: expose contrasting viewpoints, surface risks, prompt alternatives. They call the "autopilot" risk of users deferring and disengaging a greater challenge than hallucinations. Sources: [arXiv 2412.15030](https://arxiv.org/abs/2412.15030), [Sarkar preprint](https://advait.org/files/sarkar_2024_AI_provocateur_PREPRINT.pdf).
- Drosos, Sarkar et al., "'It makes you think': Provocations Help Restore Critical Thinking to AI-Assisted Knowledge Work" (arXiv 2501.17247, Jan 2025):
  - Design: between-subjects, n=24 (12 per condition). Each AI suggestion carried a provocation of at most two sentences, written as a plain factual critique in a yellow box on the same card.
  - Results: shortlists were more diverse with provocations (median similarity 0.30 vs 0.47 for charity, 0.55 vs 0.77 for movies) and think-aloud reflection was more frequent. Most quantitative differences were not statistically significant.
  - Caveat: participants with provocations were less likely to consider that the AI suggestion itself could be wrong, a possible new over-reliance.
  - "Warning fatigue" appeared under time pressure. Experts found generic provocations redundant. Participants wanted provocations that are actionable (buttons) and that come with examples.
  - Recommendations: attach the provocation to its suggestion, use plain non-persona language, avoid alert styling, make it specific, and tailor it to expertise.

  Source: [arXiv 2501.17247 HTML](https://arxiv.org/html/2501.17247v1).

- Kosmyna et al. (MIT Media Lab), "Your Brain on ChatGPT: Accumulation of Cognitive Debt when Using an AI Assistant for Essay Writing Task" (arXiv 2506.08872, June 2025):
  - n=54 students in three groups: LLM (GPT-4o), search engine, brain-only. In an optional fourth session, n=18 switched conditions.
  - EEG connectivity was strongest in the brain-only group, then search, then LLM.
  - Most LLM users struggled to quote from their own essays and reported partial or no ownership.
  - LLM-to-brain switchers showed weaker connectivity than people who had practised without tools.

  Caveats: small sample, a preprint, and "cognitive debt" is the authors' interpretation. Press coverage overstated it as long-term harm. Sources: [The Decoder](https://the-decoder.com/mit-study-shows-cognitive-debt-through-chatgpt-heres-what-it-means-in-real-world-practice/), [LIRNEasia journal club, Dec 2025](https://lirneasia.net/2025/12/lirneasia-journal-club-your-brain-on-chatgpt-exploring-the-cognitive-debt-of-ai-assisted-writing), [LIRNEasia PDF](https://lirneasia.net/wp-content/uploads/2025/12/Your-Brain-on-ChatGPT_Final.pdf).

- Andy Matuschak on review and resurfacing:
  - "Evergreen note maintenance approximates spaced repetition": revisiting and revising linked notes spaces your exposure to ideas, guided by current interest. It is not efficient for memory, since it lacks the testing effect, but it uses something like the generation effect.
  - Existing spaced repetition systems discourage evergreen notes: flashcards are too fragmented and cut off from context and related notes to support synthesis.
  - "Spaced repetition may be a helpful tool to incrementally develop inklings."

  Sources: [Matuschak: maintenance approximates SR](https://notes.andymatuschak.org/Evergreen_note_maintenance_approximates_spaced_repetition), [Matuschak: SR discourages evergreen notes](https://notes.andymatuschak.org/zMXZQANJPzCDUFPrUAYAFrn), [Matuschak working notes](https://notes.andymatuschak.org/zEZi3ytBhZHHweRYNAosQ1g).

- A community implementation, Obsidian Spaced Repetition, includes "incremental writing", which reviews a writing inbox on spaced intervals to decide how each note should evolve, not to memorize it. Sources: [obsidian-spaced-repetition docs](https://docsearch.algolia.com/mcp/docs/repo/st3v3nmw/obsidian-spaced-repetition), [Obsidian forum thread](https://forum.obsidian.md/t/spaced-repetition-for-evergreen-notes/5603).

### Inferences

- For MordomoOS, these patterns are best supported by the evidence:
  - **Reason-first:** before the AI answers a question about the vault, offer "write your current take" and give feedback on it, as ExtendAI did.
  - **Attached provocations:** every AI synthesis note gets one or two plain-language "counterpoint / what's missing / which note disagrees" lines, linked to specific notes and with action buttons. Avoid warning styling.
  - **Graded escalation:** ambient cues for individual reflection (for example, "3 open questions in this area"); active questions only when stakes are high.
  - **Resurfacing as incremental writing:** a review queue of half-formed notes, scheduled with spacing, where each card offers "develop / link / merge / archive". This beats a flashcard model.
- Anti-sycophancy: ExtendAI echoing user views and the "less likely to doubt the AI" result both say a devil's-advocate mode must be specific and source-anchored. "The note from <date> argues the opposite" works; a generic "consider other views" does not.
- The cognitive-debt evidence argues against features that write the user's notes for them by default. The user should author, and AI should propose, link, question and summarize with citations, while ownership stays visible (who wrote which text).

### Gaps

- No 2024-2026 study evaluates AI resurfacing or serendipity features specifically inside PKM tools.
- The ACM DL page for Lee et al. was not fetched directly; figures come from Microsoft's summary.
- The rest of Drosos et al. (its discussion section) was not read beyond the first 100k characters.

## 4. Trust and provenance UX: sources, citations, why something was retrieved, reviewing and editing AI memory

### Takeaway

Major assistants converged in 2025 on:

- a single viewable and editable memory surface;
- separate toggles for explicit saved memories and memory inferred from chat history;
- an incognito/temporary mode;
- per-project memory scopes.

Source-grounded tools (NotebookLM) keep citations attached to saved outputs and let users choose which sources ground them. "Why was this retrieved" explanations are rare in products. RecommendAI's "black box" finding shows the cost of leaving them out.

### Cited Findings

- OpenAI, April 2025: ChatGPT memory has two types, "saved memories" (things the user asked it to remember) and "chat history" (insights gathered from past chats), and each can be switched off in Settings. Memory can be edited in conversation, users can ask what it remembers, and Temporary Chat neither uses nor updates memory. In June 2025 a lighter version rolled out to free users, with longer-term memory for Plus and Pro. Source: [OpenAI, Memory and new controls for ChatGPT](https://openai.com/index/memory-and-new-controls-for-chatgpt/).
- A third-party source claims that when saved memory fills up, users are notified and must delete items. This is not confirmed by OpenAI. Source: [Bluehost blog](https://www.bluehost.com/blog/?p=280116).
- Anthropic's Claude memory:
  - A "Manage memory" view (Settings > Capabilities > "View and edit memory") shows a memory summary. Users can edit it by asking Claude or with a pencil icon. Sources: [Anthropic Help Center](https://support.claude.com/en/articles/11817273), [Anthropic, Bringing memory to Claude](https://www.anthropic.com/news/memory).
  - Incognito chats are kept out of history and memory for all users (Sept 2025), and memory is project-scoped, each project with its own separate memory (Pro/Max, Oct 23 2025). Sources: [Anthropic](https://www.anthropic.com/news/memory), [VentureBeat](https://venturebeat.com/ai/anthropic-adds-memory-to-claude-team-and-enterprise-incognito-for-all).
  - Conflicting sources: the Help Center says deleted conversations are removed from memory synthesis within about 24 hours, but a third-party guide says deleting a chat does not delete memories derived from it. Sources: [Anthropic Help Center](https://support.claude.com/en/articles/11817273), contradicted by [ai-toolbox.co](https://www.ai-toolbox.co/claude-management-and-productivity/claude-memory-how-it-works-2026).
- NotebookLM keeps citations in notes saved from chat answers and lets users choose which sources feed generated outputs. Source: [9to5Google, Mar 2025](https://9to5google.com/2025/03/27/notebooklm-mind-map/).
- RecommendAI-style ready-made recommendations felt like a "black box" disconnected from the user's reasoning. Source: [Microsoft Research CHI 2025](https://www.microsoft.com/en-us/research/?p=1136647).
- Lee et al. identify "information verification" as the new core of critical work with AI. That argues for UIs that make verification cheap, such as inline citations that jump to the source. Source: [Microsoft Research](https://www.microsoft.com/en-us/research/?p=1136647).

### Inferences

- For an agent "second brain" (MordomoOS), the memory review screen should:
  - list every agent-written memory or note as an item, with provenance (source session or file, timestamp, author: human or agent);
  - support approve, edit and reject, plus an inbox of pending agent writes;
  - keep scopes separate (global, area, project);
  - offer an "incognito" mode in which agents can read but not write.

  This combines the ChatGPT and Claude controls with the provocation research.

- Every AI synthesis or "related" suggestion should carry a "why": shared links, a matching passage, or similarity score plus the top shared terms. Every claim should carry a clickable citation to the file and line. MordomoOS's "related" edges currently appear to be unexplained lines on the graph.
- Show authorship visibly: mark AI-generated text distinctly from human-written text in the editor and preview, given the MIT ownership findings.

### Gaps

- No HCI study found specifically on memory-review screens (ChatGPT or Claude) and whether users actually audit memories.
- "Why this was retrieved" explanations in PKM products: no primary documentation found. The Smart Connections Pro "configurable ranking" is not an explanation UI.

## 5. Dashboards: which views over a knowledge base are actionable

### Takeaway

Evidence here is thin. Practitioners mostly use the graph and dashboards as diagnostics: orphans, untouched areas, under-linked drafts, maturity of clusters. Research favours ambient indicators for individual reflection and active prompts when behaviour should change. That suggests a dashboard of a few actionable counts that link to queues, rather than vanity heatmaps.

### Cited Findings

- Konik's diagnostic uses map directly to dashboard widgets:
  - orphans, meaning MOCs or indexes are stale;
  - folders not touched lately;
  - duplicate notes, meaning sync errors;
  - under-linked work-in-progress, meaning a concept needs development;
  - dense clusters, meaning material is ready to publish.

  Source: [Eleanor Konik](https://www.eleanorkonik.com/its-not-just-a-pretty-gimmick-in-defense-of-obsidians-graph-view).

- Passive ambient visualization supported individual thinking; active questions shifted behaviour more. The information balance must avoid overload, and escalation thresholds should be customizable. Source: [Microsoft Research, "Are We On Track?", CHI 2025](https://www.microsoft.com/en-us/research/?p=1136647).
- Under time pressure, users ignore repeated prompts ("warning fatigue"), so the number of nudges should be limited and each should be actionable. Source: [Drosos et al. 2025](https://arxiv.org/html/2501.17247v1).
- Matuschak: maintenance and review of notes, guided by current interest, is itself the mechanism of synthesis. So a dashboard should feed a review queue rather than just report statistics. Source: [Matuschak](https://notes.andymatuschak.org/Evergreen_note_maintenance_approximates_spaced_repetition).

### Inferences

- An actionable "Today" or dashboard for MordomoOS would include:
  1. **Open loops:** unchecked tasks, "TODO/?" markers and open questions extracted from notes, each linking to its source line.
  2. **Decisions:** recent decision notes, and decisions due for review.
  3. **Stale areas:** areas or folders with no edits in N days but high in-degree.
  4. **Orphans and broken links**, with one-click fixes (broken links are already computed).
  5. **Agent writes awaiting review.**
  6. **Resurfaced items:** 3-5 notes from the spaced review queue, plus "on this day".
  7. **Under-linked new notes**, with suggested links from embeddings.

  Activity heatmaps and timeline playback are low-actionability and should be secondary.

- Keep the counts small and every item clickable into a queue, to avoid warning fatigue.

### Gaps

- No empirical study found on PKM dashboards (open loops, stale areas, heatmaps) and their effect on use. Dataview- and Tana-query dashboards are practitioner patterns I did not verify with sources in this pass.
- No primary source found for "on this day" features in specific products.
