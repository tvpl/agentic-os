/**
 * How an app that loads on demand registers itself (.specs/features/limpeza-legado, door 1). A plugin is a folder
 * under `src/plugins/` whose `index.ts` exports one `AppPlugin`; the host (`desktop/apps.tsx`) turns it into an
 * entry of `APPS` and nothing else imports the plugin's code, so the app's chunk is fetched when its route opens.
 * A plugin reaches the host only by the modules `legacy.graph.test.ts` lists (C25): the typed registry of commands
 * for its keys, the primitives of `ui` for its layers, the interface helpers.
 */
import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { TKey } from "../i18n";

export interface AppPlugin {
  kind: string;
  /** The route the app answers to; the host keeps a deep link into it. */
  route: `/${string}`;
  titleKey: TKey;
  refKey: TKey;
  /** One line under the name where the app is offered. */
  descKey: TKey;
  Icon: LucideIcon;
  /** The only door to the plugin's code: a dynamic `import()` of its view, so it stays out of the main chunk. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the views take their own props
  load: () => Promise<{ default: ComponentType<any> }>;
}
