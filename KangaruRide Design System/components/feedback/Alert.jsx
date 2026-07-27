import React from "react";
import { Icon } from "../core/Icon.jsx";

const TONES = {
  info: { fg: "var(--kr-info)", bg: "var(--kr-info-tint)", icon: "info" },
  success: { fg: "var(--kr-success)", bg: "var(--kr-success-tint)", icon: "circle-check" },
  warning: { fg: "var(--kr-warning)", bg: "var(--kr-warning-tint)", icon: "triangle-alert" },
  error: { fg: "var(--kr-error)", bg: "var(--kr-error-tint)", icon: "circle-alert" },
};

export function Alert({ tone = "info", title, children, action, onDismiss, style, ...rest }) {
  const t = TONES[tone] || TONES.info;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-3)",
        padding: "var(--space-3) var(--space-4)",
        background: t.bg,
        border: "1px solid " + t.fg,
        borderRadius: "var(--radius-md)",
        ...style,
      }}
      {...rest}
    >
      <Icon name={t.icon} size={18} style={{ color: t.fg, marginTop: 1 }} />
      <div style={{ flex: 1 }}>
        {title && <p style={{ font: "var(--type-label)", fontWeight: "var(--weight-semibold)", color: t.fg }}>{title}</p>}
        {children && <div style={{ font: "var(--type-body-dense)", color: "var(--text-body)", marginTop: title ? 2 : 0 }}>{children}</div>}
      </div>
      {action}
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Dismiss" style={{ border: "none", background: "transparent", color: t.fg, cursor: "pointer", padding: 0 }}>
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  );
}
