/**
 * "Entidades (N)" of the note panel (.specs/features/cerebro-entidades-resumos, AC 76; design.md "Dobra - Entidades do
 * painel da nota"): right after "Menções sem link", with its header and density, the entities this note names
 * (`GET /api/memory/entities?file=<id>`, Landing 8a) as chips with the kind's icon and the name, each opening
 * `/brain/entities?key=<key>`. With none, "Nenhuma entidade nesta nota."; with the entities off, no fold.
 */
import { ApiError } from "../../api";
import { useT } from "../../i18n";
import { useRouteQuery } from "../../queries";
import { useBrainMode } from "../BrainViewSwitch";
import { RequestFailed } from "../RequestFailed";
import { Fold } from "../notes/Fold";
import { KIND_ICON, entityLink } from "./entityKinds";
import "./entitiesFold.css";

export function EntitiesFold({ id }: { id: number | null }) {
  const t = useT();
  const brain = useBrainMode();
  const list = useRouteQuery(
    ["memory", "entities", "file", id],
    "GET /api/memory/entities",
    { query: { file: id ?? 0, limit: 200 } },
    { enabled: id !== null, retry: false },
  );
  if (list.error instanceof ApiError && list.error.code === "entities_disabled") return null;
  return (
    <Fold title={t("entities.fold", { n: list.data?.total ?? "…" })}>
      {id === null || list.isPending ? (
        <p className="notes-panel-state">
          <span className="spinner sm" aria-hidden /> {t("common.loading")}
        </p>
      ) : list.isError ? (
        <RequestFailed message={list.error.message} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <p className="mf-dim">{t("entities.fold.none")}</p>
      ) : (
        <div className="ent-fold-chips">
          {list.data.items.map((e) => {
            const Icon = KIND_ICON[e.kind];
            return (
              <button
                key={e.key}
                type="button"
                className="btn sm"
                onClick={() => brain.go("entities", entityLink(e.key))}
              >
                <Icon aria-hidden size={14} />
                {e.name}
              </button>
            );
          })}
        </div>
      )}
    </Fold>
  );
}
