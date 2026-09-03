import { Link } from "react-router-dom";
import { BrainCircuit, Grid3x3, Plus } from "lucide-react";
import { useT } from "../../i18n";

export default function MicroAppsWidget() {
  const t = useT();
  return (
    <>
      <Link className="microapp-row" to="/brain">
        <span className="ma-icon">
          <BrainCircuit aria-hidden />
        </span>
        <span className="ma-text">
          <span className="ma-name">{t("nav.brain")}</span>
          <span className="ma-desc">{t("microapp.brain.desc")}</span>
        </span>
        <span className="ma-arrow" aria-hidden>
          →
        </span>
      </Link>
      <Link className="microapp-row" to="/pixel">
        <span className="ma-icon">
          <Grid3x3 aria-hidden />
        </span>
        <span className="ma-text">
          <span className="ma-name">{t("nav.pixel")}</span>
          <span className="ma-desc">{t("microapp.pixel.desc")}</span>
        </span>
        <span className="ma-arrow" aria-hidden>
          →
        </span>
      </Link>
      <Link className="microapp-row" to="/connectors">
        <span className="ma-icon ghost">
          <Plus aria-hidden />
        </span>
        <span className="ma-text">
          <span className="ma-name dim">{t("conn.title")}</span>
          <span className="ma-desc">{t("microapp.notConfigured")}</span>
        </span>
        <span className="ma-arrow" aria-hidden>
          →
        </span>
      </Link>
    </>
  );
}
