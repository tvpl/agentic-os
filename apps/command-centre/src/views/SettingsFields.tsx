/**
 * Autosaving text/number fields for Settings.
 *
 * Every field on the Settings page saves on its own (there is no Save button).
 * `useDraftField` keeps a local, controlled draft so a refetch (SSE
 * `settings.changed`, another tab, a rejected PUT) never wipes what the user is
 * typing, validates before sending, and reports "Saving… / Saved / error"
 * right under the input instead of only in a toast.
 */
import { Copy } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { SettingsDoc, SettingsPatch } from "../api";
import { useT, type Lang, type TKey } from "../i18n";
import { useToast } from "../components/ui";
import { Badge, Button, Field } from "../components/primitives";
import { copyText } from "./shared";

/** Outcome of a settings PUT — never rejects, so `void put()` callers stay safe. */
export type SaveResult = { ok: true } | { ok: false; error: string };
/**
 * The settings tabs' write. It takes the same patch type as `api.putSettings`, so a
 * key that moved to the UI preferences is refused here too, even through a spread.
 */
export type Put = (patch: SettingsPatch, silent?: boolean) => Promise<SaveResult>;

/** A validated parse: the value to save, or the message to show under the field. */
export type Parsed<V> = { value: V } | { error: string };

export type Translate = (key: TKey) => string;

export interface DraftFieldOptions<V> {
  serverValue: V;
  /** Server value → text in the input (default `String`). */
  format?: (value: V) => string;
  /** Text → value or validation error. Called with the raw text; trim inside. */
  parse: (text: string) => Parsed<V>;
  /** Same value as the server? (default: compares the formatted strings). */
  equals?: (a: V, b: V) => boolean;
  save: (value: V) => Promise<SaveResult>;
}

export type DraftStatus = "idle" | "saving" | "saved" | "error";

export const SAVED_FLASH_MS = 1500;

export function useDraftField<V>({ serverValue, format, parse, equals, save }: DraftFieldOptions<V>) {
  const fmt = useCallback((v: V) => (format ? format(v) : String(v)), [format]);
  const same = useCallback((a: V, b: V) => (equals ? equals(a, b) : fmt(a) === fmt(b)), [equals, fmt]);
  const serverText = fmt(serverValue);

  const [text, setText] = useState(serverText);
  const [dirty, setDirtyState] = useState(false);
  const [status, setStatus] = useState<DraftStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  // Errors are shown live only after a commit attempt failed validation, so a
  // half-typed value ("10" on the way to "1024") is not flagged mid-keystroke.
  const [touched, setTouched] = useState(false);
  const dirtyRef = useRef(false);
  const focused = useRef(false);
  const saveSeq = useRef(0);
  const flash = useRef<number | null>(null);
  const setDirty = useCallback((v: boolean) => {
    dirtyRef.current = v;
    setDirtyState(v);
  }, []);

  // Follow the server only when its value changes while the user is not editing
  // this field. (Not on `dirty` changes: right after a save the query may not have
  // caught up yet and the old value would flash back.)
  useEffect(() => {
    if (!dirtyRef.current && !focused.current) setText(serverText);
  }, [serverText]);

  useEffect(
    () => () => {
      saveSeq.current += 1;
      if (flash.current) window.clearTimeout(flash.current);
    },
    [],
  );

  let liveError: string | null = null;
  if (touched && dirty) {
    const parsed = parse(text);
    if ("error" in parsed) liveError = parsed.error;
  }
  const shownError = liveError ?? (status === "error" ? error : null);

  const revert = useCallback(() => {
    setText(serverText);
    setDirty(false);
    setTouched(false);
    setError(null);
    setStatus("idle");
  }, [serverText, setDirty]);

  const commit = useCallback(async () => {
    if (!dirtyRef.current) {
      setText(serverText);
      return;
    }
    const parsed = parse(text);
    if ("error" in parsed) {
      setTouched(true);
      setError(parsed.error);
      setStatus("error");
      return;
    }
    if (same(parsed.value, serverValue)) {
      revert();
      return;
    }
    const seq = ++saveSeq.current;
    setError(null);
    setStatus("saving");
    const res = await save(parsed.value);
    if (seq !== saveSeq.current) return;
    if (res.ok) {
      setText(fmt(parsed.value));
      setDirty(false);
      setTouched(false);
      setStatus("saved");
      if (flash.current) window.clearTimeout(flash.current);
      flash.current = window.setTimeout(() => {
        flash.current = null;
        setStatus((s) => (s === "saved" ? "idle" : s));
      }, SAVED_FLASH_MS);
    } else {
      setTouched(true);
      setError(res.error);
      setStatus("error");
    }
  }, [fmt, parse, revert, same, save, serverText, serverValue, setDirty, text]);

  const onChange = useCallback(
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setText(e.target.value);
      setDirty(true);
      setStatus((s) => (s === "error" || s === "saved" ? "idle" : s));
    },
    [setDirty],
  );
  const onFocus = useCallback(() => {
    focused.current = true;
  }, []);
  const onBlur = useCallback(() => {
    focused.current = false;
    void commit();
  }, [commit]);
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const multiline = e.currentTarget.tagName === "TEXTAREA";
      if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        revert();
      }
    },
    [commit, revert],
  );

  return {
    text,
    dirty,
    status,
    error: shownError,
    invalid: shownError !== null,
    onChange,
    onFocus,
    onBlur,
    onKeyDown,
    commit,
    revert,
  };
}

/** "Saving… / Saved" line under an autosaving input; the saved mark fades out. */
export function DraftStatusLine({ status }: { status: DraftStatus }) {
  const t = useT();
  const [fading, setFading] = useState(false);
  useEffect(() => {
    setFading(false);
    if (status !== "saved") return;
    const id = window.setTimeout(() => setFading(true), SAVED_FLASH_MS - 400);
    return () => window.clearTimeout(id);
  }, [status]);
  if (status !== "saving" && status !== "saved") return null;
  return (
    <span
      className={`hint draft-status ${status}`}
      role="status"
      aria-live="polite"
      style={{ transition: "opacity 0.4s", opacity: fading ? 0 : 1 }}
    >
      {status === "saving" ? t("settings.saving") : t("settings.saved")}
    </span>
  );
}

export interface DraftFieldProps<V> extends DraftFieldOptions<V> {
  id: string;
  label: string;
  hint?: string;
  placeholder?: string;
  className?: string;
  type?: "text" | "number";
  min?: number;
  max?: number;
  step?: number;
  /** Renders a textarea; saves on blur or Ctrl/Cmd+Enter. */
  rows?: number;
  /** Rendered after the input, on the same line (e.g. a colour picker). */
  trailing?: ReactNode;
  testId?: string;
}

/** A labelled autosaving input: controlled draft, validation, inline status. */
export function DraftField<V>({
  id,
  label,
  hint,
  placeholder,
  className,
  type = "text",
  min,
  max,
  step,
  rows,
  trailing,
  testId,
  ...options
}: DraftFieldProps<V>) {
  const draft = useDraftField(options);
  const describedBy = draft.error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const shared = {
    id,
    className: ["input", className ?? ""].filter(Boolean).join(" "),
    value: draft.text,
    placeholder,
    "aria-invalid": draft.invalid || undefined,
    "aria-describedby": describedBy,
    "data-testid": testId,
    onChange: draft.onChange,
    onFocus: draft.onFocus,
    onBlur: draft.onBlur,
    onKeyDown: draft.onKeyDown,
  };
  const input = rows ? (
    <textarea {...shared} rows={rows} />
  ) : (
    <input {...shared} type={type} min={min} max={max} step={step} />
  );
  return (
    <Field label={label} htmlFor={id} hint={hint} error={draft.error ?? undefined}>
      {trailing ? (
        <div className="row-actions" style={{ alignItems: "center", flexWrap: "nowrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>{input}</div>
          {trailing}
        </div>
      ) : (
        input
      )}
      <DraftStatusLine status={draft.status} />
    </Field>
  );
}

/* ------------------------------------------------------------ parsers ---- */

export function parseRequiredText(t: Translate): (text: string) => Parsed<string> {
  return (text) => {
    const v = text.trim();
    return v ? { value: v } : { error: t("settings.requiredField") };
  };
}

/** Free text where empty means "unset" (saved as null). */
export function parseOptionalText(text: string): Parsed<string | null> {
  return { value: text.trim() || null };
}

export function parsePort(t: Translate): (text: string) => Parsed<number> {
  return (text) => {
    const v = text.trim();
    if (!/^\d+$/.test(v)) return { error: t("settings.invalidPort") };
    const n = Number(v);
    return n >= 1024 && n <= 65535 ? { value: n } : { error: t("settings.invalidPort") };
  };
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  if (typeof intl.supportedValuesOf === "function") {
    try {
      return intl.supportedValuesOf("timeZone").includes(tz) || tz === "UTC";
    } catch {
      /* fall through to the constructor probe */
    }
  }
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function parseTimezone(t: Translate): (text: string) => Parsed<string> {
  return (text) => {
    const v = text.trim();
    return isValidTimeZone(v) ? { value: v } : { error: t("settings.invalidTimezone") };
  };
}

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** `#rrggbb` (a missing `#` is added); normalised to lower case like `<input type=color>`. */
export function parseHexColor(t: Translate): (text: string) => Parsed<string> {
  return (text) => {
    let v = text.trim();
    if (/^[0-9a-fA-F]{6}$/.test(v)) v = `#${v}`;
    return HEX_RE.test(v) ? { value: v.toLowerCase() } : { error: t("settings.invalidHex") };
  };
}

/** Number ≥ 0 (optionally integer). */
export function parseNonNegative(t: Translate, { integer = false } = {}): (text: string) => Parsed<number> {
  return (text) => {
    const v = text.trim();
    if (v === "") return { error: t("settings.invalidNonNegative") };
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || (integer && !Number.isInteger(n)))
      return { error: t("settings.invalidNonNegative") };
    return { value: n };
  };
}

/** Comma-separated list; `required` rejects an empty list. */
export function parseCommaList(t: Translate, { required = false } = {}): (text: string) => Parsed<string[]> {
  return (text) => {
    const list = text
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (required && list.length === 0) return { error: t("settings.requiredField") };
    return { value: list };
  };
}

/** Comma/whitespace separated list. */
export function parseTokenList(text: string): Parsed<string[]> {
  return {
    value: text
      .split(/[,\s]+/)
      .map((x) => x.trim())
      .filter(Boolean),
  };
}

/** One entry per line. */
export function parseLineList(text: string): Parsed<string[]> {
  return {
    value: text
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean),
  };
}

export function parseHttpsList(t: Translate): (text: string) => Parsed<string[]> {
  return (text) => {
    const parsed = parseTokenList(text);
    if ("error" in parsed) return parsed;
    return parsed.value.every((u) => u.startsWith("https://"))
      ? parsed
      : { error: t("settings.invalidRegistry") };
  };
}

export const joinComma = (list: string[]) => list.join(", ");
export const joinLines = (list: string[]) => list.join("\n");
export const sameList = (a: string[], b: string[]) => a.join(" ") === b.join(" ");

/* -------------------------------------------------- identity fields ---- */

type Identity = Pick<SettingsDoc, "systemName" | "theme" | "language" | "accentColor" | "port" | "timezone">;

/**
 * Name, theme, language, accent and network fields of the Identity tab.
 * Kept free of data-fetching so it can be rendered in tests with a fake `put`.
 */
export function IdentityFields({ s, put, setLang }: { s: Identity; put: Put; setLang: (l: Lang) => void }) {
  const t = useT();
  return (
    <>
      <DraftField
        id="st-name"
        label={t("settings.name")}
        serverValue={s.systemName}
        parse={parseRequiredText(t)}
        save={(systemName) => put({ systemName })}
      />
      <div className="grid grid-2">
        <Field label={t("settings.theme")} htmlFor="st-theme">
          <select
            id="st-theme"
            className="input"
            value={s.theme}
            onChange={(e) => void put({ theme: e.target.value as SettingsDoc["theme"] }, true)}
          >
            <option value="dark">{t("settings.dark")}</option>
            <option value="light">{t("settings.light")}</option>
            <option value="system">{t("settings.system")}</option>
          </select>
        </Field>
        <Field label={t("settings.language")} htmlFor="st-lang">
          <select
            id="st-lang"
            className="input"
            value={s.language}
            onChange={(e) => {
              const language = e.target.value as Lang;
              // Switch the UI only once the server accepted it; a failure leaves the select as it was.
              void put({ language }, true).then((r) => r.ok && setLang(language));
            }}
          >
            <option value="en">English</option>
            <option value="pt-BR">Português (Brasil)</option>
          </select>
        </Field>
        <DraftField
          id="st-accent"
          label={t("settings.accent")}
          className="mono"
          placeholder="#7c5cff"
          serverValue={s.accentColor}
          parse={parseHexColor(t)}
          equals={(a, b) => a.toLowerCase() === b.toLowerCase()}
          save={(accentColor) => put({ accentColor }, true)}
          trailing={
            <input
              id="st-accent-picker"
              type="color"
              className="input"
              aria-label={t("settings.accent")}
              style={{ height: 36, width: 48, padding: 3, flex: "none" }}
              value={HEX_RE.test(s.accentColor) ? s.accentColor : "#000000"}
              onChange={(e) => void put({ accentColor: e.target.value }, true)}
            />
          }
        />
        <DraftField
          id="st-port"
          label={t("settings.port")}
          hint={t("settings.portHint")}
          type="number"
          min={1024}
          max={65535}
          serverValue={s.port}
          parse={parsePort(t)}
          save={(port) => put({ port })}
        />
      </div>
      <DraftField
        id="st-tz"
        label={t("settings.timezone")}
        hint={t("settings.timezoneHint")}
        placeholder="America/Sao_Paulo"
        serverValue={s.timezone}
        parse={parseTimezone(t)}
        save={(timezone) => put({ timezone })}
      />
    </>
  );
}

/** A value the UI cannot change (set by the environment before the service starts). */
export function ReadOnlyPathField({
  id,
  label,
  hint,
  value,
  placeholder,
  testId,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  placeholder?: string;
  testId?: string;
}) {
  const t = useT();
  const toast = useToast();
  return (
    <Field
      label={
        <>
          {label}{" "}
          <Badge kind="state" tone="dim" title={hint}>
            {t("settings.readOnlyField")}
          </Badge>
        </>
      }
      htmlFor={id}
      hint={hint}
    >
      <div className="row-actions" style={{ alignItems: "center", flexWrap: "nowrap" }}>
        <input
          id={id}
          className="input mono"
          readOnly
          aria-readonly
          aria-describedby={`${id}-hint`}
          title={t("settings.readOnlyFieldHint")}
          value={value}
          placeholder={placeholder}
          data-testid={testId}
          style={{ flex: 1, minWidth: 0, opacity: 0.8 }}
        />
        <Button
          size="sm"
          variant="secondary"
          icon={<Copy aria-hidden />}
          aria-label={t("common.copy")}
          title={t("common.copy")}
          disabled={!value}
          onClick={async () => {
            const copied = await copyText(value);
            toast(t(copied ? "common.copied" : "skills.copyFailed"), copied ? "ok" : "danger");
          }}
        />
      </div>
    </Field>
  );
}
