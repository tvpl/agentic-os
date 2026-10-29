/**
 * How the work-context tests render (.specs/features/cerebro-contextos, S5): the providers the shells give a screen
 * (queries, router, toasts, confirmations, the command registry) around it, in one language. The network is
 * `./testnet`, mocked in by each test file.
 */
import type { ReactElement, ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { I18nContext, type Lang } from "../i18n";
import { ToastProvider } from "../components/ui";
import { ConfirmProvider } from "../hooks/useConfirm";
import { CommandRegistry, CommandsProvider } from "../commands/registry";

export function renderWith(
  ui: ReactElement,
  { lang = "en", registry = new CommandRegistry() }: { lang?: Lang; registry?: CommandRegistry } = {},
): RenderResult & { qc: QueryClient; registry: CommandRegistry } {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const container = document.createElement("div");
  container.className = "app";
  document.getElementById("root")!.appendChild(container);
  // A wrapper, not a tree: `rerender` keeps the providers (and the cache) and changes only the screen.
  const Providers = ({ children }: { children: ReactNode }) => (
    <I18nContext.Provider value={{ lang, setLang: () => undefined }}>
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <CommandsProvider registry={registry}>
            <ToastProvider>
              <ConfirmProvider>{children}</ConfirmProvider>
            </ToastProvider>
          </CommandsProvider>
        </QueryClientProvider>
      </MemoryRouter>
    </I18nContext.Provider>
  );
  const result = render(ui, { container, wrapper: Providers });
  return { ...result, qc, registry };
}
