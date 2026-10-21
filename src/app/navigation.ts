import {
  CalendarClock,
  CalendarHeart,
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
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/events', label: 'Event', icon: CalendarHeart },
  { path: '/budget', label: 'Budget', icon: Wallet },
  { path: '/timeline', label: 'Timeline', icon: CalendarClock },
  { path: '/vendors', label: 'Vendors', icon: Store },
  { path: '/assistant', label: 'Assistant', icon: Sparkles },
  { path: '/ideas', label: 'Ideas', icon: Lightbulb },
];
