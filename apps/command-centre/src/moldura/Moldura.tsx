/**
 * The app frame (.specs/features/moldura-app/design.md, Tela 1): the second
 * complete shell, beside the immersive Núcleo. Four regions and nothing
 * floating over them — a sidebar with labelled places, a top bar, the
 * route's view in the content and the conversation docked on the right.
 *
 * The views are the same ones the Núcleo shows in its scenes (`APPS`); the
 * conversation is the same `Console`, stacked. What the Núcleo answers with a
 * lâmina, the frame answers with a page (a run, an app) or a drawer (a
 * document). This file only composes: the layout state is `useFrameLayout`,
 * what the rest of the app calls is `useFrameActions`.
 */
import { Suspense, useEffect, useMemo, useRef } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import type { Meta } from "../api";
import { useT } from "../i18n";
import { Skeleton } from "../components/ui";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { useDialog } from "../components/dialog";
import { appForPath } from "../desktop/apps";
import { AppRouteContext, type AppRoute } from "../desktop/appRoute";
import { DesktopActionsProvider } from "../desktop/actions";
import { useApprovals } from "../runs/ApprovalCards";
import SkillDeck from "../desktop/SkillDeck";
import Console from "../desktop/console/Console";
import Today from "./Today";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { DocDrawer } from "./DocDrawer";
import { useFrameLayout } from "./useFrameLayout";
import { useFrameActions } from "./useFrameActions";
import { useHeadingsBelowTitle, useScrimPress } from "./hooks";
import { navItemFor } from "./nav";
import "../desktop/desktop.css";
import "./moldura.css";

export interface MolduraProps {
  meta: Meta;
  onMetaChanged: () => void;
  onOpenPalette: () => void;
}

export default function Moldura({ meta, onMetaChanged, onOpenPalette }: MolduraProps) {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const layout = useFrameLayout();
  const { actions, doc, closeDoc, deckOpen, setDeckOpen, activeRuns } = useFrameActions();
  const current = navItemFor(location.pathname);
  const app = appForPath(location.pathname);

  // The conversation as a drawer is a dialog that stays where it is: it holds a live conversation.
  const chat = useRef<HTMLElement>(null);
  const closeChat = () => layout.setChat(false);
  useDialog(chat, closeChat, {
    open: layout.chatDrawer,
    initialFocus: () => chat.current?.querySelector<HTMLElement>("textarea"),
  });
  useScrimPress(closeChat, layout.chatDrawer);
  // Narrow: a followed link is a decision made; the unfolded rail folds back.
  const { foldSidebar } = layout;
  useEffect(() => foldSidebar(), [location.pathname, foldSidebar]);

  const content = useRef<HTMLElement>(null);
  useHeadingsBelowTitle(content);

  /* ---- the route, for the views that read their own path ----------------- */
  const route = useMemo<AppRoute>(
    () => ({
      pathname: location.pathname,
      search: location.search,
      setLocation: (next) => {
        const pathname = next.pathname ?? location.pathname;
        const search = next.search ?? location.search;
        navigate(`${pathname}${search}`, { replace: next.pathname === undefined });
      },
    }),
    [location.pathname, location.search, navigate],
  );

  // The event stream keeps this fresh (`approval.*` invalidate it); the hook's slow poll is the fallback.
  const pending = useApprovals().data?.length ?? 0;

  // Not a place of the frame: Today is where an unknown address lands.
  if (!current) return <Navigate to="/" replace />;

  const View = app?.Component;
  const veil = doc !== null || layout.chatDrawer || layout.navOverlay;
  return (
    <DesktopActionsProvider value={actions}>
      <AppRouteContext.Provider value={route}>
        <div
          className="mold"
          data-collapsed={layout.collapsed ? "" : undefined}
          data-chat={layout.chatOpen ? (layout.narrow ? "drawer" : "column") : undefined}
          data-narrow={layout.narrow ? "" : undefined}
        >
          <Sidebar
            name={meta.name}
            current={current}
            collapsed={layout.collapsed}
            overlay={layout.navOverlay}
            pending={pending}
            onToggle={layout.toggleSidebar}
            onFold={layout.foldSidebar}
          />

          <div className="mold-center">
            <TopBar
              title={t(current.labelKey)}
              chatOpen={layout.chatOpen}
              modalOpen={veil}
              onOpenPalette={onOpenPalette}
              onToggleChat={() => layout.setChat(!layout.chatOpen)}
            />
            <main className="mold-main" ref={content}>
              {app && View ? (
                <div className="app-panel" data-app={app.kind} key={app.kind}>
                  <ErrorBoundary name={t(current.labelKey)} resetKey={location.pathname}>
                    <Suspense fallback={<Skeleton page lines={6} />}>
                      <View onMetaChanged={onMetaChanged} />
                    </Suspense>
                  </ErrorBoundary>
                </div>
              ) : (
                <div className="mold-scroll">
                  <ErrorBoundary name={t("moldura.nav.today")} resetKey={location.pathname}>
                    <Today />
                  </ErrorBoundary>
                </div>
              )}
              {doc !== null && <DocDrawer path={doc} onClose={closeDoc} />}
            </main>
          </div>

          {veil && <div className="mold-veil" aria-hidden />}
          <aside
            ref={chat}
            className="mold-chat"
            aria-label={t("moldura.top.chat")}
            hidden={!layout.chatOpen}
            {...(layout.chatDrawer ? { role: "dialog", "aria-modal": true, tabIndex: -1 } : {})}
          >
            <div className="mold-chat-head">
              <span className="mold-chat-t">{t("moldura.top.chat")}</span>
              <button
                type="button"
                className="mold-icon-btn"
                aria-label={t("moldura.chat.close")}
                title={t("moldura.chat.close")}
                onClick={closeChat}
              >
                <X aria-hidden />
              </button>
            </div>
            <Console
              busy={activeRuns > 0}
              deckOpen={deckOpen}
              onToggleDeck={(open) => setDeckOpen((v) => open ?? !v)}
              stacked
            />
          </aside>
          <SkillDeck open={deckOpen} onClose={() => setDeckOpen(false)} />
        </div>
      </AppRouteContext.Provider>
    </DesktopActionsProvider>
  );
}
