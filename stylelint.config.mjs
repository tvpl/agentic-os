/**
 * CSS lint for the Command Centre (design-system feature).
 *
 * The point is one rule: a colour is a token. A colour literal (hex, a named
 * or system colour, rgb/rgba/hsl/hsla and the other colour functions, a colour
 * inside a data: URI) may appear only inside the blocks of theme.css that
 * define tokens (`:root`, `[data-theme]`, `[data-preset]`), which switch the
 * first three rules off by comment. Everything else says `var(--token)` or
 * `color-mix()` over tokens (`transparent` and `currentColor` are fine).
 *
 * This file is also a guarded surface: typography.test.ts (C5, C6) fails when
 * it grows an `ignoreFiles`, `overrides` or `ignore` option, or when a rule
 * above is weakened, so the exemptions cannot move out of theme.css here.
 *
 * The rest is stylelint-config-standard, minus the rules under "Off on
 * purpose". Hit counts are over the tree as of this change; every one of them
 * would rewrite or reorder lines unrelated to colour, and those that touch the
 * cascade could change what is drawn.
 */
export default {
  extends: ["stylelint-config-standard"],
  rules: {
    // --- the colour rules (design.md "Cor") -------------------------------
    "color-no-hex": true,
    "color-named": "never",
    "function-disallowed-list": [
      "rgb",
      "rgba",
      "hsl",
      "hsla",
      "hwb",
      "lab",
      "lch",
      "oklab",
      "oklch",
      "color",
      "device-cmyk",
    ],
    "declaration-property-value-disallowed-list": {
      // An inline image carries colours of its own, out of reach of every theme.
      "/.*/": ["/url\\(\\s*[\"']?data:/i"],
      // System colours (Canvas, ButtonFace, Highlight…) are colours by name, which `color-named` does not see.
      // They are refused in every property, shadows, filters, gradients, `stop-color`, custom properties
      // and `-webkit-text-fill-color` included, except the few whose values are names or strings of
      // another kind (a grid area called `field`, an animation called `highlight`).
      "/^(?!grid|animation|transition|view-transition|counter|content|will-change|font-family|quotes|list-style|cursor)/":
        [
          "/(^|[\\s,(])(canvas|canvastext|linktext|visitedtext|activetext|buttonface|buttontext|buttonborder|field|fieldtext|highlight|highlighttext|selecteditem|selecteditemtext|mark|marktext|graytext|accentcolor|accentcolortext)($|[\\s,)])/i",
        ],
    },

    // --- off on purpose ---------------------------------------------------
    // Prettier already formats the CSS (lint-staged); these blank-line rules
    // disagree with how it and the authors group declarations (about 3,000 hits in 16 files).
    "rule-empty-line-before": null,
    "at-rule-empty-line-before": null,
    "comment-empty-line-before": null,
    "declaration-empty-line-before": null,
    "custom-property-empty-line-before": null,
    // Cascade order: reordering or merging selectors to satisfy these can change
    // which rule wins (209 and 78 hits in 11 and 7 files). Worth a feature of its
    // own with screenshots (cleanup, feature 12).
    "no-descending-specificity": null,
    "no-duplicate-selectors": null,
    // Colour notation: standard wants `rgb(0 0 0 / 50%)` and short hex. All 65
    // hits are in the token blocks of theme.css, which write colours as `#hex`
    // and `rgba()`; rewriting them is churn that adds nothing to "every colour
    // is a token".
    "color-function-notation": null,
    "color-function-alias-notation": null,
    "alpha-value-notation": null,
    "color-hex-length": null,
    // Syntax modernisation, no effect on what is drawn. These are autofixable and
    // have 1 to 21 hits each, spread over six files (theme, desktop, nucleo,
    // backend, brainScene, runsScene); this change is about colour and type
    // size, so tidying them up is left to the cleanup feature (12).
    "value-keyword-case": null,
    "length-zero-no-unit": null,
    "selector-not-notation": null,
    "shorthand-property-no-redundant-values": null,
    "keyframe-selector-notation": null,
    "font-family-name-quotes": null,
    "declaration-block-no-redundant-longhand-properties": null,
    // The range syntax (`width >= 600px`) needs Safari 16.4; the macOS shell is a WKWebView.
    "media-feature-range-notation": null,
    // Renaming `.step-waiting_approval` and `.entity--iris` means changing the TSX that sets them.
    "selector-class-pattern": null,
    // `word-break: break-word` (9) and `clip` in the visually-hidden pattern (1): still the
    // widest-supported spelling for what they do.
    "property-no-deprecated": null,
    "declaration-property-value-keyword-no-deprecated": null,
    // `-webkit-line-clamp` / `-webkit-box`, `-webkit-mask*`, `-webkit-appearance` and
    // `-webkit-background-clip` have no unprefixed equivalent that WKWebView honours
    // everywhere, and there is no autoprefixer in the build to write them for us.
    "property-no-vendor-prefix": null,
  },
};
