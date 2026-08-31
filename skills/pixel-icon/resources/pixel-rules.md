# Pixel-art rules (read before drawing)

## Silhouette first
- The icon must read as a shape at 16px. Draw the outline mentally before
  filling details; if the concept needs more than ~60% of cells, simplify.
- Center of mass in the middle; leave a 1-cell margin on all sides.

## Grid discipline
- Integer cells only — never half-pixels, never transforms with fractions.
- Symmetric subjects get true symmetry (mirror columns around the axis).
- Diagonals step 1:1 or 2:1 consistently; mixed step ratios look broken.

## Palette
- ≤ 4 colors: 1 dominant, 1 shade (darker ~25%), optional highlight, optional
  outline. On transparent backgrounds, make sure the dominant color works on
  BOTH dark and light surfaces or add a 1px outline.

## SVG template
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" shape-rendering="crispEdges">
  <rect x="3" y="2" width="1" height="1" fill="#f97316"/>
  <!-- one rect per lit cell; group same-color cells with <g fill="…"> -->
</svg>
```
Group cells by color with `<g fill>` to keep files compact.

## Consistency checklist (apply to the whole set)
- Same grid size, same margin, same outline thickness, same light direction.
- Preview every icon side by side before finishing; fix the odd one out.
