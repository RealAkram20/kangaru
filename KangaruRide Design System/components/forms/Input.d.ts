export interface InputProps {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  type?: string;
  size?: "sm" | "md" | "lg";
  /** Lucide icon inside the field, left of the text. */
  iconLeft?: string;
  iconRight?: string;
  /** Render the value in JetBrains Mono — odometer readings, plates, reference codes. */
  mono?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  /** Static trailing unit, e.g. "km" or "UGX". */
  suffix?: string;
  id?: string;
  style?: React.CSSProperties;
}

export declare function Input(props: InputProps): JSX.Element;
