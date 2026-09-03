/**
 * Per-widget settings (analysis item 23), rendered from the registry's
 * `configSchema` and persisted in `settings.dashboardLayout[id].config`.
 * Anchored to the gear that opens it, so the widget stays visible while the
 * value changes.
 */
import { Popover } from "../components/primitives";
import { useT, type TKey } from "../i18n";
import type { WidgetConfig } from "./defaultLayout";
import { defaultConfig, type WidgetDefinition } from "./registry";
import { cfgBool, cfgNumber, cfgString, type ConfigField } from "./widgetTypes";

export interface WidgetConfigPopoverProps {
  definition: WidgetDefinition;
  title: string;
  config: WidgetConfig | undefined;
  anchor: HTMLElement;
  onChange: (next: WidgetConfig | undefined) => void;
  onClose: () => void;
}

export default function WidgetConfigPopover({
  definition,
  title,
  config,
  anchor,
  onChange,
  onClose,
}: WidgetConfigPopoverProps) {
  const t = useT();
  const schema = definition.configSchema ?? [];
  const set = (key: string, value: unknown) =>
    onChange({ ...defaultConfig(definition), ...config, [key]: value });

  return (
    <Popover
      open
      onClose={onClose}
      anchor={anchor}
      placement="bottom-end"
      ariaLabel={`${t("desktop.config.title")} — ${title}`}
      className="widget-config-pop"
    >
      <div className="wc-head">
        <span className="hud-label accent">{t("desktop.config.title")}</span>
        <span className="wc-title truncate">{title}</span>
      </div>
      {schema.length === 0 ? (
        <p className="widget-muted">{t("desktop.config.none")}</p>
      ) : (
        <div className="wc-fields">
          {schema.map((field) => (
            <ConfigRow key={field.key} field={field} config={config} onSet={set} />
          ))}
        </div>
      )}
      {schema.length > 0 && (
        <button type="button" className="btn sm ghost wc-reset" onClick={() => onChange(undefined)}>
          {t("desktop.config.reset")}
        </button>
      )}
    </Popover>
  );
}

function ConfigRow({
  field,
  config,
  onSet,
}: {
  field: ConfigField;
  config: WidgetConfig | undefined;
  onSet: (key: string, value: unknown) => void;
}) {
  const t = useT();
  const label = t(field.labelKey as TKey);
  const id = `wc-${field.key}`;
  if (field.kind === "toggle") {
    return (
      <label className="wc-row toggle" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={cfgBool(config, field.key, field.default)}
          onChange={(e) => onSet(field.key, e.target.checked)}
        />
        <span>{label}</span>
      </label>
    );
  }
  if (field.kind === "number") {
    return (
      <label className="wc-row" htmlFor={id}>
        <span>{label}</span>
        <input
          id={id}
          type="number"
          className="input sm"
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          value={cfgNumber(config, field.key, field.default)}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onSet(field.key, Math.max(field.min, Math.min(field.max, Math.round(n))));
          }}
        />
      </label>
    );
  }
  if (field.kind === "select") {
    return (
      <label className="wc-row" htmlFor={id}>
        <span>{label}</span>
        <select
          id={id}
          className="input sm"
          value={cfgString(config, field.key, field.default)}
          onChange={(e) => onSet(field.key, e.target.value)}
        >
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.labelKey ? t(o.labelKey as TKey) : (o.label ?? o.value)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="wc-row" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="text"
        className="input sm"
        placeholder={field.placeholder}
        value={cfgString(config, field.key, field.default)}
        onChange={(e) => onSet(field.key, e.target.value)}
      />
    </label>
  );
}
