export interface EmptyStateProps {
  /** Lucide icon in a green-tint circle. */
  icon?: string;
  title?: string;
  /** One sentence on why it is empty, or what to do. */
  description?: string;
  action?: React.ReactNode;
  /** Reduced vertical padding, for use inside a card. */
  compact?: boolean;
  style?: React.CSSProperties;
}

export declare function EmptyState(props: EmptyStateProps): JSX.Element;
