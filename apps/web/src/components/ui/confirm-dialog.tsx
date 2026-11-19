import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  resolveConfirmCopy,
  type ConfirmCopy,
  type ConfirmOptions,
} from "@/lib/confirm";

/**
 * Promise-based replacement for `window.confirm`.
 *
 * Native confirm blocks the main thread, cannot be styled, and shows an
 * unstyled browser prompt on mobile. This keeps the same one-line call site
 * (`if (!(await confirm(...))) return;`) while rendering an accessible Base UI
 * alert dialog. The destructive action is never the initial focus target.
 */

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm harus dipakai di dalam ConfirmProvider");
  }
  return confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmCopy | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setOpen(false);
    resolve?.(value);
  }, []);

  const confirm = useCallback<ConfirmFn>((options) => {
    // A second call while a dialog is still open answers the first one "no".
    resolver.current?.(false);

    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setRequest(resolveConfirmCopy(options));
      setOpen(true);
    });
  }, []);

  // Resolve a pending promise if the provider unmounts mid-question.
  useEffect(
    () => () => {
      resolver.current?.(false);
      resolver.current = null;
    },
    [],
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) settle(false);
        }}
      >
        {request && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{request.title}</AlertDialogTitle>
              {request.description && (
                <AlertDialogDescription>{request.description}</AlertDialogDescription>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button type="button" variant="outline" onClick={() => settle(false)}>
                {request.cancelLabel}
              </Button>
              <Button
                type="button"
                variant={request.tone === "destructive" ? "destructive" : "default"}
                onClick={() => settle(true)}
              >
                {request.confirmLabel}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
