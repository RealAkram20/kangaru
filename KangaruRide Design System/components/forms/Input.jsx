import React from "react";
import { Icon } from "../core/Icon.jsx";

export function Input({
  value,
  defaultValue,
  onChange,
  placeholder,
  type = "text",
  size = "md",
  iconLeft,
  iconRight,
  mono = false,
  invalid = false,
  disabled = false,
  readOnly = false,
  suffix,
  id,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const h = size === "sm" ? "var(--control-h-sm)" : size === "lg" ? "var(--control-h-lg)" : "var(--control-h-md)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        height: h,
        padding: "0 12px",
        background: disabled ? "var(--surface-subtle)" : "var(--surface-card)",
        border: "1px solid " + (invalid ? "var(--kr-error)" : focus ? "var(--action-primary)" : "var(--border-input)"),
        borderRadius: "var(--radius-input)",
        boxShadow: focus ? "0 0 0 3px rgba(1,144,61,.16)" : "none",
        transition: "var(--transition-control)",
        opacity: disabled ? 0.7 : 1,
        ...style,
      }}
    >
      {iconLeft && <Icon name={iconLeft} size={16} style={{ color: "var(--text-placeholder)" }} />}
      <input
        id={id}
        type={type}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          outline: "none",
          background: "transparent",
          font: mono ? "var(--type-identifier)" : size === "lg" ? "var(--type-body)" : "var(--type-body-dense)",
          color: "var(--text-body)",
          fontVariantNumeric: type === "number" || mono ? "tabular-nums" : "normal",
        }}
        {...rest}
      />
      {suffix && <span style={{ font: "var(--type-caption)", color: "var(--text-secondary)" }}>{suffix}</span>}
      {iconRight && <Icon name={iconRight} size={16} style={{ color: "var(--text-placeholder)" }} />}
    </div>
  );
}
