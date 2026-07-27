import React from "react";
import { Icon } from "../core/Icon.jsx";

export function Pagination({ page = 1, pageCount = 1, pageSize, total, onPageChange, style, ...rest }) {
  const btn = (dir, icon, disabled) => (
    <button
      onClick={() => !disabled && onPageChange && onPageChange(page + dir)}
      disabled={disabled}
      aria-label={dir < 0 ? "Previous page" : "Next page"}
      style={{
        width: 32,
        height: 32,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--surface-card)",
        border: "1px solid var(--border-default)",
        borderRadius: "var(--radius-control)",
        color: disabled ? "var(--text-disabled)" : "var(--text-body)",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <Icon name={icon} size={16} />
    </button>
  );
  const from = pageSize ? (page - 1) * pageSize + 1 : null;
  const to = pageSize && total ? Math.min(page * pageSize, total) : null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-4)",
        padding: "var(--space-3) var(--space-4)",
        borderTop: "1px solid var(--border-default)",
        ...style,
      }}
      {...rest}
    >
      <span className="kr-tabular" style={{ font: "var(--type-caption)", color: "var(--text-secondary)" }}>
        {from && to && total ? `${from}–${to} of ${total}` : `Page ${page} of ${pageCount}`}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        {btn(-1, "chevron-left", page <= 1)}
        <span className="kr-tabular" style={{ font: "var(--type-label)", color: "var(--text-body)", minWidth: 64, textAlign: "center" }}>
          {page} / {pageCount}
        </span>
        {btn(1, "chevron-right", page >= pageCount)}
      </div>
    </div>
  );
}
