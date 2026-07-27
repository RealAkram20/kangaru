import React from "react";
import { Icon } from "../core/Icon.jsx";

export function KPIStat({ label, value, unit, delta, deltaDirection = "up", icon, tone = "default", hint, style, ...rest }) {
  const good = deltaDirection === "up";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        padding: "var(--pad-card-compact)",
        background: tone === "accent" ? "var(--surface-accent)" : "var(--surface-card)",
        border: "1px solid " + (tone === "accent" ? "var(--kr-green-tint)" : "var(--border-default)"),
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-xs)",
        ...style,
      }}
      {...rest}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
        <span style={{ font: "var(--type-label)", color: "var(--text-secondary)" }}>{label}</span>
        {icon && <Icon name={icon} size={16} style={{ color: "var(--text-accent)" }} />}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ font: "var(--type-kpi)", fontSize: "var(--text-3xl)", color: "var(--text-heading)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
        {unit && <span style={{ font: "var(--type-label)", color: "var(--text-secondary)" }}>{unit}</span>}
      </div>
      {(delta || hint) && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {delta && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, font: "var(--type-caption)", fontWeight: "var(--weight-semibold)", color: good ? "var(--kr-success)" : "var(--kr-error)" }}>
              <Icon name={good ? "trending-up" : "trending-down"} size={12} strokeWidth={2.5} />
              {delta}
            </span>
          )}
          {hint && <span style={{ font: "var(--type-caption)", color: "var(--text-secondary)" }}>{hint}</span>}
        </div>
      )}
    </div>
  );
}
