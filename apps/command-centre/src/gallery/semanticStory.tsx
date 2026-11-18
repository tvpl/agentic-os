/**
 * "Busca por significado" in the gallery (.specs/features/cerebro-busca-significado, C134): the block's header and its
 * three options with "Modelo neste computador" disabled (no runtime), a model row in each of the four states and the
 * license dialog drawn in place, from fixture data (the gallery never talks to the API).
 */
import type { SettingsShape } from "../views/settings/shared";
import { ModelRow, SemanticSearch, TermsContent, type Model } from "../views/settings/SemanticSearch";

const none = () => undefined;
const GEMMA: Model = {
  id: "embeddinggemma-300m-q4",
  kind: "embedder",
  name: "EmbeddingGemma 300M",
  bytes: 218_726_989,
  dimensions: 768,
  license: { name: "Gemma", acceptRequired: true },
  state: "absent",
};
const ROWS: Model[] = [
  GEMMA,
  { ...GEMMA, id: "a", state: "downloading", progress: { done: 120_000_000, total: 218_726_989 } },
  { ...GEMMA, id: "b", state: "ready" },
  { ...GEMMA, id: "c", state: "failed", reason: "checksum" },
];
const SETTINGS = {
  memory: { embeddings: { enabled: true, provider: "hash", sendRemote: false } },
} as unknown as SettingsShape;

export default function SemanticStory() {
  return (
    <>
      <SemanticSearch s={SETTINGS} put={() => Promise.resolve({ ok: true })} />
      <ul className="ss ss-models card">
        {ROWS.map((m) => (
          <ModelRow
            key={m.id}
            m={m}
            active={false}
            onInstall={none}
            onCancel={none}
            onRemove={none}
            onUse={none}
          />
        ))}
      </ul>
      <div className="modal narrow story-dialog" role="dialog" aria-label="Termos do modelo">
        <div className="modal-head">
          <h2>Termos do modelo</h2>
        </div>
        <TermsContent m={GEMMA} onCancel={none} onAccept={none} />
      </div>
    </>
  );
}
