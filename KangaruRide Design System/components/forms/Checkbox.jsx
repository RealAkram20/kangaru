import React from "react";
import { Icon } from "../core/Icon.jsx";

export function Checkbox({ checked, defaultChecked, onChange, label, description, disabled = false, indeterminate = false, id, style, ...rest }) {
  const [internal, setInternal] = React.useState(!!defaultChecked);
  const on = checked === undefined ? internal : checked;
  const toggle = () => {
    if (disabled) return;
    if (checked === undefined) setInternal(!on);
    onChange && onChange(!on);
  };
  return (
    <label
      htmlFor={id}
      onClick={(e) => {
        e.preventDefault();
        toggle();
      }}
      style={{
        display: "inline-flex",
        alignItems: description ? "flex-start" : "center",
        gap: "var(--space-2)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        ...style,
      }}
      {...rest}
    >
      <span
        role="checkbox"
        aria-checked={indeterminate ? "mixed" : on}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            toggle();
          }
        }}
        style={{
          width: 18,
          height: 18,
          flex: "0 0 auto",
          marginTop: description ? 1 : 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "var(--radius-sm)",
          background: on || indeterminate ? "var(--action-primary)" : "var(--surface-card)",
          border: "1px solid " + (on || indeterminate ? "var(--action-primary)" : "var(--border-input)"),
          color: "var(--text-on-brand)",
          transition: "var(--transition-control)",
        }}
      >
        {indeterminate ? <Icon name="minus" size={12} strokeWidth={3} /> : on ? <Icon name="check" size={12} strokeWidth={3} /> : null}
      </span>
      {(label || description) && (
        <span>
          {label && <span style={{ font: "var(--type-body-dense)", color: "var(--text-body)" }}>{label}</span>}
          {description && <span style={{ display: "block", font: "var(--type-caption)", color: "var(--text-secondary)", marginTop: 2 }}>{description}</span>}
        </span>
      )}
    </label>
  );
}
