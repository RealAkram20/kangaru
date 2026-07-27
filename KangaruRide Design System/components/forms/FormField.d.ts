export interface FormFieldProps {
  /** Inter Medium 14px. Sentence case, no colon. */
  label?: string;
  htmlFor?: string;
  /** Helper text below the control; replaced by `error` when present. */
  hint?: string;
  error?: string;
  required?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export declare function FormField(props: FormFieldProps): JSX.Element;
