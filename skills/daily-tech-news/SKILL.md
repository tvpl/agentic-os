---
name: Daily Tech & AI News
description: >-
  Search today's technology and AI news, select what matters, and produce a
  short briefing artifact with sources.
triggers:
  - /daily-tech-news
  - "tech news"
  - "noticias de tecnologia"
inputs:
  - name: topics
    label: Extra topics (optional)
    type: text
    required: false
    placeholder: e.g. agents, local LLMs, robotics…
providers: [claude, cursor, codex]
recommendedModel: null
recommendedEffort: low
mode: read_only
enabled: true
version: 1.0.0
changelog:
  - "1.0.0 — initial version (MordomoOS seed)"
guardrails:
  - Requires the provider's web search capability; if unavailable, say so and stop — never fabricate news or dates.
  - Cite the source URL for every item; no item without a source.
  - Read-only outside the artifacts directory.
successCriteria:
  - A briefing artifact exists with 5–8 items, each with source and a one-line "why it matters".
  - No item is older than 48 hours unless explicitly marked as context.
examples:
  - "Morning run via the daily routine, with topics 'coding agents'."
---

# Daily Tech & AI News

Produce today's briefing on technology and AI (plus the extra topics, if any).

## Procedure

1. Confirm you can search the web. If not, write a single-line artifact stating
   the capability is unavailable for this provider and stop.
2. Search for significant news from the last 24–48 h across: AI models and
   agents, developer tooling, major tech industry moves, and the extra topics.
3. Select 5–8 items that a busy builder should actually know. Skip rumors and
   duplicate coverage.
4. Write `briefing-YYYY-MM-DD.md` in the artifacts directory. Per item:
   headline, one-paragraph summary, **why it matters** in one line, source URL.
5. Close the artifact with a "one thing to try today" suggestion drawn from the
   items. Reply with the artifact path and the item count.
