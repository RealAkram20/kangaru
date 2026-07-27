export interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (next: boolean) => void;
  label?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  style?: React.CSSProperties;
}

export declare function Switch(props: SwitchProps): JSX.Element;
