export interface IconButtonProps {
  /** Lucide icon name. */
  icon: string;
  /** Required — becomes aria-label and the tooltip. Icon-only controls are never unlabelled. */
  label: string;
  size?: "sm" | "md" | "lg";
  variant?: "ghost" | "outline" | "primary";
  /** Set on navy chrome (sidebar, topbar). */
  onChrome?: boolean;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  style?: React.CSSProperties;
}

export declare function IconButton(props: IconButtonProps): JSX.Element;
