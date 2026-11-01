import {
  Activity,
  CalendarDays,
  CircleUserRound,
  History,
  LayoutDashboard,
  ScanLine,
  Settings,
  type LucideIcon,
} from "lucide-react";

import type { GlobalNavKey } from "@/lib/navigation";

const ICONS: Record<GlobalNavKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  events: CalendarDays,
  activity: Activity,
  settings: Settings,
  staffHome: LayoutDashboard,
  staffScan: ScanLine,
  staffHistory: History,
  staffProfile: CircleUserRound,
};

export function NavIcon({ name, className }: { name: GlobalNavKey; className?: string }) {
  const Icon = ICONS[name];

  return <Icon aria-hidden="true" className={className} />;
}
