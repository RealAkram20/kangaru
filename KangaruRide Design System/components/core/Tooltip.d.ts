export interface TooltipProps {
  children?: React.ReactNode;
  /** Short, sentence-case, no terminal period. */
  label: string;
  placement?: "top" | "bottom" | "left" | "right";
  style?: React.CSSProperties;
}

export declare function Tooltip(props: TooltipProps): JSX.Element;
