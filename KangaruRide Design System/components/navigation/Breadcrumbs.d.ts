export interface BreadcrumbItem {
  label: string;
  id?: string;
}

export interface BreadcrumbsProps {
  items?: BreadcrumbItem[];
  /** Set when rendered inside the navy Topbar. */
  onChrome?: boolean;
  onNavigate?: (idOrLabel: string) => void;
  style?: React.CSSProperties;
}

export declare function Breadcrumbs(props: BreadcrumbsProps): JSX.Element;
