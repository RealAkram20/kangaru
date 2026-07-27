export interface DialogProps {
  open?: boolean;
  title?: string;
  /** One or two sentences stating exactly what will happen. */
  description?: string;
  children?: React.ReactNode;
  /** Action row, right-aligned on a sunken footer. Cancel first, primary last. */
  footer?: React.ReactNode;
  onClose?: () => void;
  width?: number;
  /** destructive/warning add a tinted alert glyph — required for cancellations and credit notes. */
  tone?: "default" | "warning" | "destructive";
  style?: React.CSSProperties;
}

export declare function Dialog(props: DialogProps): JSX.Element;
