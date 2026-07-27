export interface ButtonProps {
  children?: React.ReactNode;
  /** primary = the one committing action per view. destructive for irreversible finance/trip actions. */
  variant?: "primary" | "secondary" | "destructive" | "ghost";
  /** sm 32px (table row actions) · md 40px (default) · lg 48px (marketing + booking CTAs) */
  size?: "sm" | "md" | "lg";
  /** Lucide icon name rendered before the label. */
  iconLeft?: string;
  /** Lucide icon name rendered after the label. */
  iconRight?: string;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  /** Set on navy chrome so ghost hover uses --surface-chrome-elevated. */
  onChrome?: boolean;
  type?: "button" | "submit" | "reset";
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  style?: React.CSSProperties;
}

export declare function Button(props: ButtonProps): JSX.Element;
