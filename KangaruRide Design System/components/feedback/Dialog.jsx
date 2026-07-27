import React from "react";
import { Icon } from "../core/Icon.jsx";

export function Dialog({ open = true, title, description, children, footer, onClose, width = 520, tone = "default", style, ...rest }) {
  if (!open) return null;
  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--overlay-scrim)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-6)",
        zIndex: 60,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: width,
          background: "var(--surface-card)",
          borderRadius: "var(--radius-modal)",
          boxShadow: "var(--shadow-modal)",
          overflow: "hidden",
          ...style,
        }}
        {...rest}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-3)", padding: "var(--space-6) var(--space-6) var(--space-4)" }}>
          {tone !== "default" && (
            <span
              style={{
                width: 36,
                height: 36,
                flex: "0 0 auto",
                borderRadius: "var(--radius-pill)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: tone === "destructive" ? "var(--kr-error-tint)" : "var(--kr-warning-tint)",
                color: tone === "destructive" ? "var(--kr-error)" : "var(--kr-warning)",
              }}
            >
              <Icon name="triangle-alert" size={18} />
            </span>
          )}
          <div style={{ flex: 1 }}>
            {title && <h2 style={{ font: "var(--type-section-title)", color: "var(--text-heading)", letterSpacing: "var(--tracking-tight)" }}>{title}</h2>}
            {description && <p style={{ font: "var(--type-body-dense)", color: "var(--text-secondary)", marginTop: 6 }}>{description}</p>}
          </div>
          {onClose && (
            <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", padding: 2 }}>
              <Icon name="x" size={18} />
            </button>
          )}
        </div>
        {children && <div style={{ padding: "0 var(--space-6) var(--space-6)" }}>{children}</div>}
        {footer && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--gap-inline)", padding: "var(--space-4) var(--space-6)", background: "var(--surface-sunken)", borderTop: "1px solid var(--border-default)" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
