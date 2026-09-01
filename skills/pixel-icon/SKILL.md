---
name: Pixel Icon Maker
description: >-
  Design a small set of pixel-art icons as crisp, self-contained SVGs — for the
  Command Centre, a project, or anything that needs a retro-futuristic mark.
triggers:
  - /pixel-icon
  - "pixel art icon"
  - "icone pixelart"
inputs:
  - name: subject
    label: What should the icons represent?
    type: textarea
    required: true
    placeholder: e.g. "email, calendar, rocket and a brain, for a dark dashboard"
  - name: grid
    label: Grid size
    type: select
    required: false
    options: ["8", "12", "16"]
  - name: colors
    label: Palette (optional)
    type: text
    required: false
    placeholder: "#f97316, #ece7dd on transparent"
providers: [claude, cursor, codex]
recommendedModel: null
recommendedEffort: medium
mode: read_only
enabled: true
version: 1.0.0
changelog:
  - "1.0.0 — initial version (MordomoOS seed)"
guardrails:
  - Output only self-contained SVG files in the artifacts directory — no external images, fonts or scripts.
  - Every icon must be a true pixel grid (integer-aligned <rect> cells with shape-rendering crispEdges), not smooth vector art.
  - Keep the set visually consistent — same grid, same palette, same visual weight.
successCriteria:
  - One .svg file per requested icon plus a preview.html contact sheet showing all icons at 1x, 4x and 8x on dark and light backgrounds.
  - Icons stay legible at 16px.
examples:
  - "Subject: 'run, pause, gear, spark' — 12px grid, orange on transparent."
---

# Pixel Icon Maker

Create a coherent pixel-art icon set for the given subject.

## Procedure

1. Read `resources/pixel-rules.md` in this skill folder before drawing.
2. Plan the set: list each icon with a one-line visual concept (silhouette
   first — what shape reads at 16px?).
3. Draw each icon as an SVG pixel grid (default 12×12 unless the user chose a
   grid): `viewBox="0 0 G G"`, one `<rect x y width="1" height="1">` per lit
   cell, `shape-rendering="crispEdges"`, palette limited to ≤ 4 colors.
4. Write each icon as `<slug>.svg` in the artifacts directory, plus
   `preview.html` — a single self-contained contact sheet rendering every icon
   at 1x/4x/8x over dark and light swatches with its name.
5. Reply with the artifact paths and one line per icon describing the design.
