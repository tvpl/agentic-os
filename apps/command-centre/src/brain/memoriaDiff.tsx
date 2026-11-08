/**
 * The diff of the trustworthy-memory screens (.specs/features/cerebro-memoria-confiavel, design.md "Binding sources"):
 * the unified diff the routes answer, read by the run diff reader (`runs/diff.ts`) and drawn as its lines are in
 * `FilesChanged.tsx`: the two line numbers, the sign (`+` or `-`, always there: a state never by colour alone) and
 * the text, in mono 12px, never rendered as Markdown.
 */
import { parseUnifiedDiff } from "../runs/diff";
import "./memoriaDiff.css";

/** A unified diff as lines: the two line numbers, the sign (`+`, `-`, always there) and the text, in mono 12px. */
export function DiffLines({ diff, label }: { diff: string; label: string }) {
  const lines = parseUnifiedDiff(diff).filter((l) => l.kind !== "meta");
  return (
    // Focusable: a diff taller than its box scrolls, and the keyboard scrolls it too.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region the keyboard must reach
    <div className="mc-diff" role="group" aria-label={label} tabIndex={0}>
      <table>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className={`mc-${l.kind}`}>
              <td aria-hidden>{l.oldNo ?? ""}</td>
              <td aria-hidden>{l.newNo ?? ""}</td>
              <td className="mc-sign">{l.kind === "add" ? "+" : l.kind === "del" ? "-" : ""}</td>
              <td>{l.text || " "}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
