export interface IdentifierProps {
  children?: React.ReactNode;
  /** plate = boxed uppercase vehicle registration · chip = boxed reference · plain = inline mono. */
  kind?: "plain" | "chip" | "plate";
  size?: "xs" | "sm" | "md";
  tone?: "default" | "muted" | "inverse";
  style?: React.CSSProperties;
}

export declare function Identifier(props: IdentifierProps): JSX.Element;
