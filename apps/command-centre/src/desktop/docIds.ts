/**
 * Documents as lâminas: the id carries the path (`doc:<path>`), so a
 * projection is self-describing and the shell knows what to render without
 * a second lookup.
 */
const DOC_PREFIX = "doc:";
export const docId = (path: string): string => DOC_PREFIX + path;
export const isDocId = (id: string): boolean => id.startsWith(DOC_PREFIX);
export const docPath = (id: string): string => id.slice(DOC_PREFIX.length);
