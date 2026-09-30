/**
 * A content icon of the Brain scene (immersive shell) as inline SVG: the same
 * path the sky strokes on its stars, so the reader, the rail and the legend
 * speak the same visual language.
 */
import { GLYPHS, type ContentKind } from "./brainGlyphs";

export function BrainGlyph({
  kind,
  size = 16,
  className,
}: {
  kind: ContentKind;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className ? `bs-glyph ${className}` : "bs-glyph"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size < 16 ? 1.9 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <path d={GLYPHS[kind]} />
    </svg>
  );
}
