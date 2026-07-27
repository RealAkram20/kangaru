import React from "react";
import { Icon } from "../core/Icon.jsx";
import { IconButton } from "../core/IconButton.jsx";

export function Topbar({ title, breadcrumbs, tenant, user, actions, onSearch, style, ...rest }) {
  return (
    <header
      style={{
        height: "var(--topbar-h)",
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-4)",
        padding: "0 var(--space-6)",
        background: "var(--surface-chrome)",
        borderBottom: "1px solid var(--border-chrome)",
        ...style,
      }}
      {...rest}
    >
      <div style={{ minWidth: 0 }}>
        {breadcrumbs && <div style={{ marginBottom: 1 }}>{breadcrumbs}</div>}
        {title && (
          <h1 style={{ font: "var(--type-section-title)", color: "var(--text-on-chrome)", letterSpacing: "var(--tracking-tight)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {title}
          </h1>
        )}
      </div>
      {onSearch && (
        <label
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            width: 300,
            height: 36,
            padding: "0 12px",
            background: "var(--surface-chrome-elevated)",
            border: "1px solid var(--border-chrome)",
            borderRadius: "var(--radius-control)",
          }}
        >
          <Icon name="search" size={16} style={{ color: "var(--text-on-chrome-secondary)" }} />
          <input
            placeholder="Search trips, plates, invoices"
            onChange={(e) => onSearch(e.target.value)}
            style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", font: "var(--type-body-dense)", color: "var(--text-on-chrome)" }}
          />
        </label>
      )}
      <div style={{ marginLeft: onSearch ? 0 : "auto", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        {tenant && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 10px",
              borderRadius: "var(--radius-control)",
              border: "1px solid var(--border-chrome)",
              background: "var(--surface-chrome-elevated)",
              font: "var(--type-label)",
              color: "var(--text-on-chrome)",
            }}
          >
            <Icon name="building-2" size={14} style={{ color: "var(--action-primary)" }} />
            {tenant}
            <Icon name="chevron-down" size={14} style={{ color: "var(--text-on-chrome-secondary)" }} />
          </span>
        )}
        {actions}
        <IconButton icon="bell" label="Notifications" onChrome />
        {user && (
          <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", paddingLeft: "var(--space-2)" }}>
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: "var(--radius-pill)",
                background: "var(--action-primary)",
                color: "var(--text-on-brand)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                font: "var(--type-label)",
                fontWeight: "var(--weight-semibold)",
              }}
            >
              {user.initials || (user.name || "?").slice(0, 2).toUpperCase()}
            </span>
            <span style={{ lineHeight: 1.2 }}>
              <span style={{ display: "block", font: "var(--type-label)", color: "var(--text-on-chrome)" }}>{user.name}</span>
              <span style={{ display: "block", font: "var(--type-caption)", color: "var(--text-on-chrome-secondary)" }}>{user.role}</span>
            </span>
          </span>
        )}
      </div>
    </header>
  );
}
