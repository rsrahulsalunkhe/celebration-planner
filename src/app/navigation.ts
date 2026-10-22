import {
  CalendarClock,
  HardDrive,
  LayoutDashboard,
  Lightbulb,
  Sparkles,
  Store,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** True when the section only explains that it is not built yet. */
  planned: boolean;
  /** Match only this exact path (used for the Overview at `/`). */
  end?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/', label: 'Overview', icon: LayoutDashboard, planned: false, end: true },
  { path: '/budget', label: 'Budget', icon: Wallet, planned: false },
  { path: '/timeline', label: 'Timeline', icon: CalendarClock, planned: false },
  { path: '/vendors', label: 'Vendors', icon: Store, planned: false },
  { path: '/assistant', label: 'Assistant', icon: Sparkles, planned: false },
  { path: '/ideas', label: 'Ideas', icon: Lightbulb, planned: true },
];

export const DATA_NAV_ITEM: NavItem = {
  path: '/data',
  label: 'Your data',
  icon: HardDrive,
  planned: false,
};
