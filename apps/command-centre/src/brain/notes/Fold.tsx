/**
 * A section of the note panel that folds (.specs/features/cerebro-vista-notas, design.md "Painel da nota"): its title is
 * a button with `aria-expanded`. Open unless `shut` says otherwise, until the person folds or unfolds it.
 */
import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function Fold({
  title,
  shut = false,
  children,
}: {
  title: string;
  shut?: boolean;
  children: ReactNode;
}) {
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? !shut;
  const body = useId();
  return (
    <section className="notes-fold">
      <h3 className="notes-fold-head">
        <button type="button" aria-expanded={open} aria-controls={body} onClick={() => setChoice(!open)}>
          {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
          {title}
        </button>
      </h3>
      <div id={body} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
