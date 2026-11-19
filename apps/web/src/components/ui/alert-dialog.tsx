import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * shadcn/ui alert dialog, powered by Base UI (already installed).
 *
 * `AlertDialog` differs from `Dialog` on purpose: no backdrop-click dismissal
 * and no close button, so an irreversible action is answered explicitly.
 * Escape still cancels, and the platform keeps focus inside the popup.
 */
export const AlertDialog = AlertDialogPrimitive.Root;

export function AlertDialogContent({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-[2px] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
      <AlertDialogPrimitive.Viewport className="fixed inset-0 z-50 grid place-items-center p-3">
        <AlertDialogPrimitive.Popup
          className={cn(
            "palette-enter w-[min(32rem,calc(100vw-1.5rem))] rounded-xl border border-border bg-background p-5 text-foreground shadow-2xl",
            className,
          )}
        >
          {children}
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Viewport>
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 flex flex-col gap-1", className)} {...props} />;
}

export function AlertDialogTitle({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title className={cn("text-lg font-semibold", className)} {...props} />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export function AlertDialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-4 flex justify-end gap-2", className)} {...props} />;
}
