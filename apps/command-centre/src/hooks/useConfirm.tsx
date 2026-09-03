/**
 * Promise-based confirmation: `const confirm = useConfirm();
 * if (await confirm({ title, body, danger })) …`
 * Rendered through `ConfirmProvider` (mounted once in App).
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { ConfirmDialog } from "../components/primitives";

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(() => Promise.resolve(false));

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

interface Pending {
  opts: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        setPending((current) => {
          // Only one confirmation at a time; a second request cancels the first.
          current?.resolve(false);
          return { opts, resolve };
        });
      }),
    [],
  );

  const settle = (ok: boolean) => {
    setPending((current) => {
      current?.resolve(ok);
      return null;
    });
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <ConfirmDialog
          title={pending.opts.title}
          body={pending.opts.body}
          confirmLabel={pending.opts.confirmLabel}
          cancelLabel={pending.opts.cancelLabel}
          danger={pending.opts.danger}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}
