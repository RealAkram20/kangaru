export interface CardProps {
  children?: React.ReactNode;
  /** Rendered in Sora SemiBold 20px inside a bordered header. */
  title?: string;
  subtitle?: string;
  /** Header-right slot — usually Buttons or IconButtons. */
  actions?: React.ReactNode;
  /** none = flush content (tables, maps). sm = 16px. md = 24px (default). */
  padding?: "none" | "sm" | "md";
  /** chrome = elevated navy card for use inside the sidebar/topbar. */
  tone?: "default" | "accent" | "sunken" | "chrome";
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
}

export declare function Card(props: CardProps): JSX.Element;
