/**
 * The one line that explains a clear stage (redesign F7).
 *
 * The desktop no longer opens with nine panels, which is the point — but an
 * empty stage has to say what the gestures are, or it reads as broken rather
 * than as quiet. The prototype showed a line over the field and let it fade;
 * this does the same, and remembers that it has been read.
 *
 * It fades on its own, and on the first thing the user does: the hint's job
 * is over the moment the desktop is in use.
 */
import { useEffect, useState } from "react";
import { useT } from "../i18n";

/** Long enough to read twice, short enough not to become furniture. */
const FADE_MS = 14_000;
const SEEN_KEY = "mordomo.desktop.hint.v1";

export default function FirstRunHint() {
  const t = useT();
  const [gone, setGone] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      // Private browsing, or storage denied: show it, never crash the desktop.
      return false;
    }
  });

  useEffect(() => {
    if (gone) return;
    const done = () => {
      setGone(true);
      try {
        localStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* nothing to remember it with; it will show once more */
      }
    };
    const timer = window.setTimeout(done, FADE_MS);
    // Any real gesture retires it early: it has done its job.
    window.addEventListener("pointerdown", done, { once: true });
    window.addEventListener("keydown", done, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", done);
      window.removeEventListener("keydown", done);
    };
  }, [gone]);

  if (gone) return null;
  return (
    <p className="first-run-hint" role="note">
      <span>{t("desktop.hint.pods")}</span>
      <span>{t("desktop.hint.keys")}</span>
    </p>
  );
}
