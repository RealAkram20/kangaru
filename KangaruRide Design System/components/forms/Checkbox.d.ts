export interface CheckboxProps {
  /** Controlled state. Omit for uncontrolled use with `defaultChecked`. */
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (next: boolean) => void;
  label?: string;
  /** Second line of muted explanatory text. */
  description?: string;
  disabled?: boolean;
  /** Header checkbox for a partially selected table. */
  indeterminate?: boolean;
  id?: string;
  style?: React.CSSProperties;
}

export declare function Checkbox(props: CheckboxProps): JSX.Element;
