import { Link, useParams } from "react-router-dom";
import { useOsProviders, useOsSkills } from "../../queries";
import { ErrorBox, Skeleton } from "../../components/ui";
import { EmptyState } from "../../components/primitives";
import { useT } from "../../i18n";
import { errorMessage, isOffline } from "../shared";
import SkillList from "./SkillList";
import SkillDetail from "./SkillDetail";

export default function Skills() {
  const { slug } = useParams();
  const t = useT();
  const skills = useOsSkills();
  const providers = useOsProviders();

  if ((skills.isPending && !skills.data) || (providers.isPending && !providers.data)) {
    return (
      <div className="page">
        <Skeleton lines={8} />
      </div>
    );
  }
  const err = skills.error ?? providers.error;
  if (err && (!skills.data || !providers.data)) {
    return (
      <div className="page">
        <ErrorBox
          message={errorMessage(err)}
          offline={isOffline(err)}
          onRetry={() => {
            void skills.refetch();
            void providers.refetch();
          }}
        />
      </div>
    );
  }
  if (!skills.data || !providers.data) return null;

  if (slug) {
    const selected = skills.data.find((s) => s.slug === slug);
    if (!selected) {
      return (
        <div className="page">
          <EmptyState
            title={t("skills.notFound")}
            body={<span className="mono">/{slug}</span>}
            action={
              <Link className="btn" to="/skills">
                ← {t("skills.title")}
              </Link>
            }
          />
        </div>
      );
    }
    // key={slug}: run configuration (provider/model/effort/inputs) is local state and must reset per skill.
    return <SkillDetail key={slug} skill={selected} providers={providers.data} />;
  }
  return <SkillList skills={skills.data} />;
}
