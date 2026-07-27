export interface AlertProps {
  tone?: "info" | "success" | "warning" | "error";
  /** Short bold summary line. */
  title?: string;
  children?: React.ReactNode;
  /** Inline resolving action, usually a secondary Button. */
  action?: React.ReactNode;
  onDismiss?: () => void;
  style?: React.CSSProperties;
}

export declare function Alert(props: AlertProps): JSX.Element;
