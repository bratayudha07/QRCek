import type { AnchorHTMLAttributes } from "react";

import { navigate } from "@/lib/router";

/**
 * Internal link that navigates in place instead of reloading the SPA.
 *
 * It keeps real anchor semantics: middle-click, ctrl/cmd-click, and "open in
 * new tab" are left to the browser. Only a plain left click is intercepted.
 */
export function AppLink({
  href,
  onClick,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string }) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);

        if (event.defaultPrevented) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }

        event.preventDefault();
        navigate(href);
      }}
    />
  );
}
