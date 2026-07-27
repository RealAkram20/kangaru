export interface BadgeProps {
  children?: React.ReactNode;
  /** Semantic tint pair from DESIGN.md §3. */
  tone?: "neutral" | "success" | "warning" | "error" | "info" | "brand";
  /** Lucide icon name — status must never be colour-only. */
  icon?: string;
  size?: "sm" | "md";
  /** Transparent fill with a currentColor hairline, for use on tinted rows. */
  outline?: boolean;
  style?: React.CSSProperties;
}

export declare function Badge(props: BadgeProps): JSX.Element;
