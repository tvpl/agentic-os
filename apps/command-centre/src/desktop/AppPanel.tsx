/**
 * The body of an app panel (redesign G2): the production view, mounted edge
 * to edge inside the plate, given its own route and its own error boundary
 * so one app crashing never takes the desktop with it.
 */
import { Suspense, useMemo } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Skeleton } from "../components/ui";
import { useT } from "../i18n";
import { APPS, type AppKind, type AppLocation } from "./apps";
import { AppRouteContext, type AppRoute } from "./appRoute";

export interface AppPanelProps {
  kind: AppKind;
  location: AppLocation;
  onLocation: (next: Partial<AppLocation>) => void;
  /** Settings needs it; the others ignore it. */
  onMetaChanged?: () => void;
}

export default function AppPanel({ kind, location, onLocation, onMetaChanged }: AppPanelProps) {
  const t = useT();
  const def = APPS[kind];
  const route = useMemo<AppRoute>(
    () => ({ pathname: location.pathname, search: location.search, setLocation: onLocation }),
    [location.pathname, location.search, onLocation],
  );
  const View = def.Component;
  return (
    <AppRouteContext.Provider value={route}>
      <div className="app-panel" data-onboarding={kind}>
        <ErrorBoundary name={t(def.titleKey)} resetKey={location.pathname}>
          <Suspense fallback={<Skeleton page lines={6} />}>
            <View onMetaChanged={onMetaChanged ?? (() => undefined)} />
          </Suspense>
        </ErrorBoundary>
      </div>
    </AppRouteContext.Provider>
  );
}
