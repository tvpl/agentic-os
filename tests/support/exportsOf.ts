import path from "node:path";
import ts from "typescript";

/**
 * What a module exports, read by the TypeScript checker the way a consumer's compiler reads it: values and types
 * apart (`export type { X }` is a type even when X is also a value inside), with the documentation comment of each.
 */

export interface ExportInfo {
  /** A consumer can use it at run time. */
  value: boolean;
  /** A consumer can use it as a type. */
  type: boolean;
  /** The doc comment of the declaration, as plain text ("" when there is none). */
  doc: string;
}

export function exportsOf(entry: string): Record<string, ExportInfo> {
  const file = path.resolve(entry);
  const program = ts.createProgram([file], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  if (!source) throw new Error(`cannot read ${file}`);
  const module = checker.getSymbolAtLocation(source);
  if (!module) return {};
  const out: Record<string, ExportInfo> = {};
  for (const symbol of checker.getExportsOfModule(module)) {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const typeOnly = (symbol.declarations ?? []).some(
      (d) => ts.isExportSpecifier(d) && (d.isTypeOnly || d.parent.parent.isTypeOnly),
    );
    out[symbol.name] = {
      value: !typeOnly && (target.flags & ts.SymbolFlags.Value) !== 0,
      type: typeOnly || (target.flags & ts.SymbolFlags.Type) !== 0,
      doc: ts.displayPartsToString(target.getDocumentationComment(checker)).trim(),
    };
  }
  return out;
}
