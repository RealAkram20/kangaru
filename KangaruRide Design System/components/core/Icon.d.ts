export interface IconProps {
  /** Lucide icon name, kebab or Pascal case: "truck", "map-pin", "MapPin". */
  name: string;
  /** Pixel box. 16 in dense tables, 20 default, 24 for nav. */
  size?: number;
  /** Lucide default is 2; use 1.5 only at 24px+. */
  strokeWidth?: number;
  /** Defaults to currentColor — colour comes from the parent. */
  color?: string;
  /** Provide only when the icon is the sole label; otherwise leave undefined (decorative). */
  title?: string;
  style?: React.CSSProperties;
}

export declare function Icon(props: IconProps): JSX.Element;
