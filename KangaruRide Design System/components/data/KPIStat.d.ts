export interface KPIStatProps {
  /** Inter Medium 14px, sentence case. */
  label: string;
  /** The number itself — Sora Bold 30px, tabular. Pre-format it (thousands separators, UGX). */
  value: string | number;
  /** Trailing unit, e.g. "km", "trips", "%". */
  unit?: string;
  /** Signed change string, e.g. "+12%". */
  delta?: string;
  /** Direction decides colour: up = success green, down = error red. */
  deltaDirection?: "up" | "down";
  /** Lucide icon in the top-right. */
  icon?: string;
  tone?: "default" | "accent";
  /** Comparison period or scope, e.g. "vs last week". */
  hint?: string;
  style?: React.CSSProperties;
}

export declare function KPIStat(props: KPIStatProps): JSX.Element;
