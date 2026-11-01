import { AppLink } from "./app-link";
import { NavIcon } from "./nav-icon";
import {
  bottomNavItems,
  isGlobalNavActive,
  isPrimaryNavItem,
  type NavMode,
} from "@/lib/navigation";
import type { AppRoute } from "@/lib/router";
import { cn } from "@/lib/utils";

/**
 * Mobile global navigation. Four always-visible destinations above the home
 * indicator, with the safe-area inset respected and the scan action emphasised
 * as the staff primary action.
 */
export function BottomNav({ mode, route }: { mode: NavMode; route: AppRoute }) {
  const items = bottomNavItems(mode);

  return (
    <nav
      aria-label="Navigasi utama"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-background pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <div className="mx-auto grid max-w-lg grid-cols-4">
        {items.map((item) => {
          const active = isGlobalNavActive(item.key, route);
          const primary = isPrimaryNavItem(item.key);

          return (
            <AppLink
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className="flex flex-col items-center justify-center gap-1 px-1 py-2 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-full transition-colors duration-150",
                  primary
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground",
                )}
              >
                <NavIcon name={item.key} className="size-[18px]" />
              </span>

              <span
                className={cn(
                  "text-[11px] leading-none",
                  active ? "font-semibold text-foreground" : "text-muted-foreground",
                )}
              >
                {item.label}
              </span>
            </AppLink>
          );
        })}
      </div>
    </nav>
  );
}
