export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  /** Plain strings or {value,label} pairs. */
  options?: (string | SelectOption)[];
  /** Shown as the empty first option. */
  placeholder?: string;
  size?: "sm" | "md" | "lg";
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  style?: React.CSSProperties;
}

export declare function Select(props: SelectProps): JSX.Element;
