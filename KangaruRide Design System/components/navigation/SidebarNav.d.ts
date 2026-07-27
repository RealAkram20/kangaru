export interface SidebarItem {
  id: string;
  label: string;
  /** Lucide icon name — every nav item has one. */
  icon: string;
  /** Count chip, e.g. unassigned bookings. */
  badge?: number | string;
}

export interface SidebarSection {
  /** Uppercase overline group label, e.g. "OPERATIONS". Omit for the first ungrouped block. */
  label?: string;
  items: SidebarItem[];
}

export interface SidebarNavProps {
  sections?: SidebarSection[];
  /** id of the active item. */
  active?: string;
  onNavigate?: (id: string) => void;
  /** Icon-only 64px rail. */
  collapsed?: boolean;
  /** Path from the page to the assets folder (for the logo). */
  basePath?: string;
  /** Bottom slot — usually the signed-in user row. */
  footer?: React.ReactNode;
  style?: React.CSSProperties;
}

export declare function SidebarNav(props: SidebarNavProps): JSX.Element;
