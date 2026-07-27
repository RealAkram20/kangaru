export interface TabItem {
  value: string;
  label: string;
  /** Lucide icon name. */
  icon?: string;
  /** Right-hand count chip — trip queues, disputed invoices, unassigned bookings. */
  count?: number;
}

export interface TabsProps {
  tabs?: (string | TabItem)[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** underline = page-level sections · pill = in-card view switch. */
  variant?: "underline" | "pill";
  /** Set when the tab strip sits on navy chrome. */
  onChrome?: boolean;
  style?: React.CSSProperties;
}

export declare function Tabs(props: TabsProps): JSX.Element;
