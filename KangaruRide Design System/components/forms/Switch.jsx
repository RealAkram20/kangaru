import React from "react";

export function Switch({ checked, defaultChecked, onChange, label, size = "md", disabled = false, style, ...rest }) {
  const [internal, setInternal] = React.useState(!!defaultChecked);
  const on = checked === undefined ? internal : checked;
  const w = size === "sm" ? 32 : 40;
  const h = size === "sm" ? 18 : 22;
  const knob = h - 4;
  const toggle = () => {
    if (disabled) return;
    if (checked === undefined) setInternal(!on);
    onChange && onChange(!on);
  };
  return (
    <label
      style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-3)", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, ...style }}
      {...rest}
    >
      <span
        role="switch"
        aria-checked={on}
        tabIndex={disabled ? -1 : 0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            toggle();
          }
        }}
        style={{
          width: w,
          height: h,
          flex: "0 0 auto",
          borderRadius: "var(--radius-pill)",
          background: on ? "var(--action-primary)" : "var(--kr-gray-border)",
          position: "relative",
          transition: "background-color var(--dur-base) var(--ease-standard)",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: on ? w - knob - 2 : 2,
            width: knob,
            height: knob,
            borderRadius: "var(--radius-pill)",
            background: "var(--kr-paper)",
            boxShadow: "var(--shadow-xs)",
            transition: "left var(--dur-base) var(--ease-standard)",
          }}
        />
      </span>
      {label && <span style={{ font: "var(--type-body-dense)", color: "var(--text-body)" }}>{label}</span>}
    </label>
  );
}
