import React from "react";
import { Icon } from "../core/Icon.jsx";

export function Tabs({ tabs = [], value, defaultValue, onChange, variant = "underline", onChrome = false, style, ...rest }) {
  const first = tabs.length ? (typeof tabs[0] === "string" ? tabs[0] : tabs[0].value) : undefined;
  const [internal, setInternal] = React.useState(defaultValue ?? first);
  const current = value === undefined ? internal : value;
  const pick = (v) => {
    if (value === undefined) setInternal(v);
    onChange && onChange(v);
  };
  const pill = variant === "pill";
  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        alignItems: "center",
        gap: pill ? 4 : "var(--space-6)",
        padding: pill ? 4 : 0,
        background: pill ? "var(--surface-subtle)" : "transparent",
        borderRadius: pill ? "var(--radius-control)" : 0,
        borderBottom: pill ? "none" : "1px solid " + (onChrome ? "var(--border-chrome)" : "var(--border-default)"),
        ...style,
      }}
      {...rest}
    >
      {tabs.map((t) => {
        const tab = typeof t === "string" ? { value: t, label: t } : t;
        const on = current === tab.value;
        return (
          <button
            key={tab.value}
            role="tab"
            aria-selected={on}
            onClick={() => pick(tab.value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: "none",
              background: pill && on ? "var(--surface-card)" : "transparent",
              boxShadow: pill && on ? "var(--shadow-xs)" : "none",
              borderRadius: pill ? "var(--radius-sm)" : 0,
              padding: pill ? "6px 12px" : "0 0 10px",
              marginBottom: pill ? 0 : -1,
              borderBottom: pill ? "none" : "2px solid " + (on ? "var(--action-primary)" : "transparent"),
              font: "var(--type-label)",
              fontWeight: on ? "var(--weight-semibold)" : "var(--weight-medium)",
              color: on ? (onChrome ? "var(--text-on-chrome)" : "var(--text-body)") : onChrome ? "var(--text-on-chrome-secondary)" : "var(--text-secondary)",
              cursor: "pointer",
              transition: "var(--transition-control)",
            }}
          >
            {tab.icon && <Icon name={tab.icon} size={15} />}
            {tab.label}
            {tab.count !== undefined && (
              <span
                style={{
                  font: "var(--type-caption)",
                  fontWeight: "var(--weight-semibold)",
                  color: on ? "var(--text-accent)" : "var(--text-secondary)",
                  background: on ? "var(--surface-accent)" : "var(--surface-subtle)",
                  borderRadius: "var(--radius-pill)",
                  padding: "1px 6px",
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
