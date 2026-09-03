/**
 * Strings owned by the "runs" frontier. Keys must stay unique across all
 * locale modules; `ptBR` must carry exactly the keys of `en` (enforced by
 * the `satisfies` clause and by i18n.test.ts).
 */
export const en = {} as const;

export const ptBR = {} satisfies Record<keyof typeof en, string>;
