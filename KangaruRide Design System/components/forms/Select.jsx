import React from "react";
import { Icon } from "../core/Icon.jsx";

export function Select({ value, defaultValue, onChange, options = [], placeholder, size = "md", invalid = false, disabled = false, id, style, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const h = size === "sm" ? "var(--control-h-sm)" : size === "lg" ? "var(--control-h-lg)" : "var(--control-h-md)";
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        height: h,
        background: disabled ? "var(--surface-subtle)" : "var(--surface-card)",
        border: "1px solid " + (invalid ? "var(--kr-error)" : focus ? "var(--action-primary)" : "var(--border-input)"),
        borderRadius: "var(--radius-input)",
        boxShadow: focus ? "0 0 0 3px rgba(1,144,61,.16)" : "none",
        transition: "var(--transition-control)",
        opacity: disabled ? 0.7 : 1,
        ...style,
      }}
    >
      <select
        id={id}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        disabled={disabled}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          appearance: "none",
          WebkitAppearance: "none",
          flex: 1,
          height: "100%",
          padding: "0 34px 0 12px",
          border: "none",
          outline: "none",
          background: "transparent",
          font: size === "lg" ? "var(--type-body)" : "var(--type-body-dense)",
          color: value || defaultValue ? "var(--text-body)" : "var(--text-placeholder)",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => {
          const opt = typeof o === "string" ? { value: o, label: o } : o;
          return (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          );
        })}
      </select>
      <Icon name="chevron-down" size={16} style={{ position: "absolute", right: 10, color: "var(--text-secondary)", pointerEvents: "none" }} />
    </div>
  );
}
