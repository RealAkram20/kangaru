import React from "react";
import { Icon } from "../core/Icon.jsx";

export function EmptyState({ icon = "inbox", title, description, action, compact = false, style, ...rest }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: "var(--space-2)",
        padding: compact ? "var(--space-8) var(--space-6)" : "var(--space-16) var(--space-6)",
        ...style,
      }}
      {...rest}
    >
      <span
        style={{
          width: 44,
          height: 44,
          borderRadius: "var(--radius-pill)",
          background: "var(--surface-accent)",
          color: "var(--text-accent)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "var(--space-2)",
        }}
      >
        <Icon name={icon} size={20} />
      </span>
      {title && <p style={{ font: "var(--type-label)", fontWeight: "var(--weight-semibold)", fontSize: "var(--text-base)", color: "var(--text-heading)" }}>{title}</p>}
      {description && <p style={{ font: "var(--type-body-dense)", color: "var(--text-secondary)", maxWidth: 360 }}>{description}</p>}
      {action && <div style={{ marginTop: "var(--space-3)" }}>{action}</div>}
    </div>
  );
}
