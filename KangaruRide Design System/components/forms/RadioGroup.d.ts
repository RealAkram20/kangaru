export interface RadioOption {
  value: string;
  label: string;
  /** Muted second line — use it to state the operational consequence of the choice. */
  description?: string;
}

export interface RadioGroupProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  options?: (string | RadioOption)[];
  name?: string;
  layout?: "vertical" | "horizontal";
  disabled?: boolean;
  style?: React.CSSProperties;
}

export declare function RadioGroup(props: RadioGroupProps): JSX.Element;
