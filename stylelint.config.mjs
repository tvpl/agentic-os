/**
 * CSS lint for the Command Centre (design-system feature).
 *
 * The point is one rule: a colour is a token. A colour literal (hex, a named
 * colour, rgb/rgba/hsl/hsla) may appear only inside the blocks of theme.css
 * that define tokens (`:root`, `[data-theme]`, `[data-preset]`), which switch
 * these rules off by comment. Everything else says `var(--token)` or
 * `color-mix()` over tokens (`transparent` and `currentColor` are fine).
 *
 * The rest is stylelint-config-standard, minus the rules listed under
 * "Off on purpose": each of them would rewrite or reorder hundreds of
 * unrelated lines of a 19k-line stylesheet in this change, and the ones that
 * touch the cascade could change what is drawn.
 */
export default {
  extends: ["stylelint-config-standard"],
  rules: {
    // --- the colour rules (design.md "Cor") -------------------------------
    "color-no-hex": true,
    "color-named": "never",
    "function-disallowed-list": ["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch"],

    // --- off on purpose ---------------------------------------------------
    // Prettier already formats the CSS (lint-staged); these blank-line rules
    // disagree with how it and the authors group declarations, 3000+ hits.
    "rule-empty-line-before": null,
    "at-rule-empty-line-before": null,
    "comment-empty-line-before": null,
    "declaration-empty-line-before": null,
    "custom-property-empty-line-before": null,
    // Cascade order: reordering or merging selectors to satisfy these can change
    // which rule wins. Worth a feature of its own with screenshots (cleanup, feature 12).
    "no-descending-specificity": null,
    "no-duplicate-selectors": null,
    // Colour notation: standard wants `rgb(0 0 0 / 50%)` and short hex. The token
    // blocks write colours as `#hex` and `rgba()`; rewriting them is churn that
    // adds nothing to "every colour is a token".
    "color-function-notation": null,
    "color-function-alias-notation": null,
    "alpha-value-notation": null,
    "color-hex-length": null,
    // Syntax modernisation with no effect on what is drawn; each would touch
    // files the feature does not otherwise need to open.
    "media-feature-range-notation": null,
    "value-keyword-case": null,
    "declaration-block-no-redundant-longhand-properties": null,
    "shorthand-property-no-redundant-values": null,
    "length-zero-no-unit": null,
    "selector-not-notation": null,
    "keyframe-selector-notation": null,
    "font-family-name-quotes": null,
    "selector-class-pattern": null,
    "property-no-deprecated": null,
    "declaration-property-value-keyword-no-deprecated": null,
    // `-webkit-backdrop-filter` and `-webkit-mask` are still needed by WKWebView
    // (the macOS shell); there is no autoprefixer in the build to replace them.
    "property-no-vendor-prefix": null,
  },
};
