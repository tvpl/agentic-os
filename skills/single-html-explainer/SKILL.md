---
name: Single-File HTML Explainer
description: >-
  Build one self-contained HTML page that explains a topic, project or decision
  clearly — no frameworks, no network calls, ready to open or share.
triggers:
  - /single-html-explainer
  - "html explicativo"
  - "explainer page"
inputs:
  - name: subject
    label: What should the page explain?
    type: textarea
    required: true
    placeholder: A topic, a project folder, an architecture decision…
  - name: audience
    label: Audience
    type: select
    required: false
    options: [technical, executive, general]
providers: [claude, cursor, codex]
recommendedModel: null
recommendedEffort: medium
mode: read_only
enabled: true
version: 1.1.0
changelog:
  - "1.0.0 — initial version (MordomoOS seed)"
  - "1.1.0 — brand/style reference moved into resources/brand.html"
guardrails:
  - Output is ONE .html file in the artifacts directory; no external CSS/JS/fonts/CDNs.
  - If the subject is a folder, read only non-secret files inside it.
  - No fabricated facts — if information is missing, mark the section as "to confirm".
successCriteria:
  - The HTML opens offline, renders cleanly, and has a title, nav-free single-page structure, and legible typography.
  - Content is specific to the subject, not generic filler.
examples:
  - "Explain the architecture of ./apps/api for a new contributor."
---

# Single-File HTML Explainer

Create `explainer.html` (one file, self-contained) about the given subject.

## Procedure

1. Understand the subject. If it is a path, explore it read-only and extract
   the real structure/facts; if it is a topic, outline the 4–6 ideas that
   matter for the audience (default: technical).
2. Draft the narrative first: title → one-paragraph "why this matters" →
   sections with concrete details → a short FAQ or glossary if useful.
3. Read `resources/brand.html` before this step and copy its tokens (palette,
   type scale, card/tag/table blocks) inline into `explainer.html` in the
   artifacts directory: semantic HTML, embedded CSS (system font stack,
   comfortable line length, light/dark via `prefers-color-scheme`), inline SVG
   only if a diagram genuinely helps.
4. Verify: valid structure, no external references, headings hierarchical.
5. Reply with the artifact path and a one-line description of each section.
