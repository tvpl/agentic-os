/**
 * What the rest of the app calls when it wants to show something
 * (`DesktopActions`), answered the frame's way. The Núcleo projects a lâmina;
 * the frame has a page for a run, a skill or an app and a drawer for a
 * document, so "open this" is a navigation or the drawer. The parts that are
 * the same in both shells live in `desktop/shellActions.ts`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useT } from "../i18n";
import { OPEN_DECK_EVENT } from "../components/CommandPalette";
import { APPS, appForPath, appId, type AppKind, type AppLocation } from "../desktop/apps";
import type { DesktopActions } from "../desktop/actions";
import type { OpenPanel } from "../desktop/panelKinds";
import { docId, docPath, isDocId } from "../desktop/docIds";
import { formSlugOf, isFormPanelId, isRunPanelId, runIdOf } from "../desktop/runPanels";
import { WIDGET_REGISTRY } from "../desktop/registry";
import { useDesktopRuns } from "../desktop/data";
import {
  focusSkillDeck,
  useActiveRunCount,
  usePanelEventBridge,
  useReferencePanel,
  useRunningSkills,
  useRunSkill,
} from "../desktop/shellActions";

export interface FrameActions {
  actions: DesktopActions;
  /** The document in the drawer, if one is open on this page. */
  doc: string | null;
  closeDoc: () => void;
  deckOpen: boolean;
  setDeckOpen: (open: boolean | ((was: boolean) => boolean)) => void;
  /** Runs in flight: the conversation shows it is busy. */
  activeRuns: number;
}

export function useFrameActions(): FrameActions {
  const t = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const app = appForPath(pathname);
  const runs = useDesktopRuns();

  // A document belongs to the page it was opened on: a new page is a new
  // subject, so following any link, run or app leaves the drawer behind. Held
  // with its page rather than cleared in an effect, so it never shows for a
  // frame over the page it does not belong to.
  const [docState, setDocState] = useState<{ path: string; page: string } | null>(null);
  const doc = docState && docState.page === pathname ? docState.path : null;
  const pageRef = useRef(pathname);
  pageRef.current = pathname;
  const openDoc = useCallback((path: string) => setDocState({ path, page: pageRef.current }), []);
  const closeDoc = useCallback(() => setDocState(null), []);

  const [deckOpen, setDeckOpen] = useState(false);
  useEffect(() => {
    const onOpenDeck = () => setDeckOpen(true);
    window.addEventListener(OPEN_DECK_EVENT, onOpenDeck);
    return () => window.removeEventListener(OPEN_DECK_EVENT, onOpenDeck);
  }, []);

  const openRun = useCallback((runId: string) => navigate(`/runs/${encodeURIComponent(runId)}`), [navigate]);
  const openApp = useCallback(
    (kind: AppKind, at?: Partial<AppLocation>) =>
      navigate(`${at?.pathname ?? APPS[kind].route}${at?.search ?? ""}`),
    [navigate],
  );
  const openSkill = useCallback(
    (slug: string) => navigate(`/skills/${encodeURIComponent(slug)}`),
    [navigate],
  );
  const runSkill = useRunSkill((out) => {
    if ("form" in out) openSkill(out.form);
    else if ("approvals" in out) navigate("/");
    else openRun(out.run);
  });
  const runningSkills = useRunningSkills(runs.data);
  const activeRuns = useActiveRunCount(runs.data);

  const openPanels = useMemo<OpenPanel[]>(() => {
    const out: OpenPanel[] = [];
    if (doc !== null) {
      const name = doc.split(/[\\/]/).pop() || doc;
      out.push({ id: docId(doc), kind: "artifact", ref: name, title: name, path: doc, minimized: false });
    }
    if (app)
      out.push({
        id: appId(app.kind),
        kind: "app",
        ref: t(app.refKey),
        title: t(app.titleKey),
        minimized: false,
      });
    return out;
  }, [doc, app, t]);
  const referencePanel = useReferencePanel(openPanels);

  // There are no lâminas here: a panel id is the page or drawer that shows the
  // same thing. An id that is none of them does nothing, as in the Núcleo.
  const openPanel = useCallback(
    (id: string) => {
      if (isDocId(id)) openDoc(docPath(id));
      else if (isRunPanelId(id)) openRun(runIdOf(id));
      else if (isFormPanelId(id)) openSkill(formSlugOf(id));
      else if (Object.hasOwn(WIDGET_REGISTRY, id)) navigate("/");
    },
    [openDoc, openRun, openSkill, navigate],
  );

  const actions = useMemo<DesktopActions>(
    () => ({
      runSkill,
      configureSkill: (skill) => openSkill(skill.slug),
      focusDeck: focusSkillDeck,
      runningSkills,
      openPanels,
      openDoc,
      openApp,
      openRun,
      openSkillForm: openSkill,
      openPanel,
      referencePanel,
    }),
    [runSkill, openSkill, runningSkills, openPanels, openDoc, openApp, openRun, openPanel, referencePanel],
  );

  usePanelEventBridge({
    open: openPanel,
    dismiss: (id) => {
      if (isDocId(id)) closeDoc();
    },
  });

  return { actions, doc, closeDoc, deckOpen, setDeckOpen, activeRuns };
}
