import React from "react";
import { Icon } from "../core/Icon.jsx";

export function Breadcrumbs({ items = [], onChrome = false, onNavigate, style, ...rest }) {
  return (
    <nav style={{ display: "flex", alignItems: "center", gap: 6, ...style }} {...rest}>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <React.Fragment key={item.label + i}>
            {i > 0 && <Icon name="chevron-right" size={12} style={{ color: onChrome ? "var(--text-on-chrome-disabled)" : "var(--text-placeholder)" }} />}
            <button
              onClick={() => !last && onNavigate && onNavigate(item.id || item.label)}
              style={{
                border: "none",
                background: "transparent",
                padding: 0,
                font: "var(--type-caption)",
                fontWeight: last ? "var(--weight-medium)" : "var(--weight-regular)",
                color: last ? (onChrome ? "var(--text-on-chrome-secondary)" : "var(--text-secondary)") : onChrome ? "var(--text-on-chrome-secondary)" : "var(--text-link)",
                cursor: last ? "default" : "pointer",
              }}
            >
              {item.label}
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
}
