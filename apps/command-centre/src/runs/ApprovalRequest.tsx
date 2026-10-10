/**
 * What a held write run would do, whole (.specs/features/escopos-dispositivo, round 1): who asked, the provider and
 * model, the mode and folder, and the prompt or the skill with every input it is given. The approval's one-line
 * description is a label and cuts long text; the person who approves reads this instead. Nothing is cut: a long
 * text sits in a bounded box that scrolls and that the keyboard can reach (the box says its length), so a request
 * cannot hide its end behind the part that fits.
 */
import { useT } from "../i18n";
import type { ApprovalRecord } from "../api";
import { approvalTarget } from "./approvals";
import "./approvalRequest.css";

function Long({ label, text }: { label: string; text: string }) {
  const t = useT();
  return (
    <pre
      className="approval-request-text mono"
      tabIndex={0}
      role="region"
      aria-label={t("runs.request.scroll", { label, n: text.length })}
    >
      {text}
    </pre>
  );
}

export function askedBy(requestedBy: string | null, t: ReturnType<typeof useT>): string {
  if (requestedBy === "owner") return t("runs.request.byOwner");
  if (requestedBy?.startsWith("device:")) {
    return t("runs.request.byDevice", { id: requestedBy.slice("device:".length, "device:".length + 8) });
  }
  return t("runs.request.byNone");
}

export function ApprovalRequest({ approval }: { approval: ApprovalRecord }) {
  const t = useT();
  if (approval.kind !== "write_run") return null;
  const target = approvalTarget(approval);
  const fromDevice = approval.requestedBy?.startsWith("device:") === true;
  return (
    <section
      className={`approval-request${fromDevice ? " from-device" : ""}`}
      aria-label={t("runs.request.title")}
      data-testid="approval-request"
    >
      <dl>
        <div>
          <dt>{t("runs.request.askedBy")}</dt>
          <dd>{askedBy(approval.requestedBy, t)}</dd>
        </div>
        {target.provider && (
          <div>
            <dt>{t("runs.request.provider")}</dt>
            <dd className="mono">
              {[target.provider, target.model, target.effort].filter(Boolean).join(" · ")}
            </dd>
          </div>
        )}
        {target.mode && (
          <div>
            <dt>{t("runs.request.mode")}</dt>
            <dd className="mono">{target.mode}</dd>
          </div>
        )}
        {target.cwd && (
          <div>
            <dt>{t("runs.request.folder")}</dt>
            <dd className="mono approval-request-path">{target.cwd}</dd>
          </div>
        )}
        {target.skillSlug && (
          <div>
            <dt>{t("runs.request.skill")}</dt>
            <dd className="mono">/{target.skillSlug}</dd>
          </div>
        )}
        {target.prompt !== null && (
          <div className="wide">
            <dt>{t("runs.request.prompt")}</dt>
            <dd>
              <Long label={t("runs.request.prompt")} text={target.prompt} />
            </dd>
          </div>
        )}
        {target.kind === "skill" &&
          (target.inputs.length === 0 ? (
            <div>
              <dt>{t("runs.request.inputs")}</dt>
              <dd>{t("runs.request.noInputs")}</dd>
            </div>
          ) : (
            target.inputs.map(([key, value]) => (
              <div className="wide" key={key}>
                <dt className="mono">{key}</dt>
                <dd>
                  <Long label={key} text={value} />
                </dd>
              </div>
            ))
          ))}
      </dl>
    </section>
  );
}
