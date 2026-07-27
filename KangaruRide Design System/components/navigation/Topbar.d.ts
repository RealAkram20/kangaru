export interface TopbarUser {
  name: string;
  /** One of the ten platform roles, e.g. "Dispatcher", "Finance". */
  role?: string;
  initials?: string;
}

export interface TopbarProps {
  /** Current page title in Sora SemiBold 20px. */
  title?: string;
  /** Optional Breadcrumbs element rendered above the title. */
  breadcrumbs?: React.ReactNode;
  /** Active tenant name — multi-tenant platform, so it is always visible. */
  tenant?: string;
  user?: TopbarUser;
  /** Extra controls left of the notification bell. */
  actions?: React.ReactNode;
  /** Supply to render the global search field. */
  onSearch?: (query: string) => void;
  style?: React.CSSProperties;
}

export declare function Topbar(props: TopbarProps): JSX.Element;
