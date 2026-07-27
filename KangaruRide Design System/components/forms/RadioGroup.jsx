import React from "react";

export function RadioGroup({ value, defaultValue, onChange, options = [], name, layout = "vertical", disabled = false, style, ...rest }) {
  const [internal, setInternal] = React.useState(defaultValue);
  const current = value === undefined ? internal : value;
  const pick = (v) => {
    if (disabled) return;
    if (value === undefined) setInternal(v);
    onChange && onChange(v);
  };
  return (
    <div
      role="radiogroup"
      style={{ display: "flex", flexDirection: layout === "horizontal" ? "row" : "column", gap: layout === "horizontal" ? "var(--space-6)" : "var(--space-3)", ...style }}
      {...rest}
    >
      {options.map((o) => {
        const opt = typeof o === "string" ? { value: o, label: o } : o;
        const on = current === opt.value;
        return (
          <label
            key={opt.value}
            onClick={() => pick(opt.value)}
            style={{ display: "inline-flex", alignItems: opt.description ? "flex-start" : "center", gap: "var(--space-2)", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1 }}
          >
            <input type="radio" name={name} checked={on} readOnly style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
            <span
              role="radio"
              aria-checked={on}
              tabIndex={disabled ? -1 : 0}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  pick(opt.value);
                }
              }}
              style={{
                width: 18,
                height: 18,
                flex: "0 0 auto",
                marginTop: opt.description ? 1 : 0,
                borderRadius: "var(--radius-pill)",
                border: "1px solid " + (on ? "var(--action-primary)" : "var(--border-input)"),
                background: "var(--surface-card)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "var(--transition-control)",
              }}
            >
              {on && <span style={{ width: 8, height: 8, borderRadius: "var(--radius-pill)", background: "var(--action-primary)" }} />}
            </span>
            <span>
              <span style={{ font: "var(--type-body-dense)", color: "var(--text-body)" }}>{opt.label}</span>
              {opt.description && <span style={{ display: "block", font: "var(--type-caption)", color: "var(--text-secondary)", marginTop: 2 }}>{opt.description}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}
