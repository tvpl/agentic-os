/**
 * Generations micro-app (analysis item 28): every image and video under
 * `artifacts/` — Pixel Studio exports included — in one grid with a lightbox.
 * It is the artifacts gallery restricted to visual kinds.
 */
import { useT } from "../i18n";
import { ArtifactGallery } from "./Artifacts";

export default function Generations() {
  const t = useT();
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("desktop.generations.title")}</h1>
          <p className="sub">{t("desktop.generations.sub")}</p>
        </div>
      </div>
      <ArtifactGallery
        only={["image", "video"]}
        emptyTitle={t("desktop.generations.empty")}
        emptyBody={t("desktop.generations.emptyBody")}
      />
    </div>
  );
}
