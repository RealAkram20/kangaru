export interface DataColumn {
  key: string;
  header: string;
  /** Right-aligns and applies tabular-nums — use for distance, duration, money. */
  numeric?: boolean;
  align?: "left" | "center" | "right";
  width?: number | string;
  sortable?: boolean;
  /** Allow the cell to wrap; default is nowrap. */
  wrap?: boolean;
  /** Custom cell renderer — StatusBadge, Identifier, row actions. */
  render?: (row: Record<string, any>) => React.ReactNode;
}

export interface DataTableProps {
  columns?: DataColumn[];
  rows?: Record<string, any>[];
  /** 8px cell padding instead of 12px — for long operational lists. */
  dense?: boolean;
  selectable?: boolean;
  onRowClick?: (row: Record<string, any>) => void;
  emptyMessage?: string;
  style?: React.CSSProperties;
}

export declare function DataTable(props: DataTableProps): JSX.Element;
