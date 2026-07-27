import React from "react";
import { Icon } from "../core/Icon.jsx";
import { Identifier } from "../core/Identifier.jsx";

const TONE = {
  done: "var(--kr-success)",
  active: "var(--action-primary)",
  warning: "var(--kr-warning)",
  error: "var(--kr-error)",
  pending: "var(--kr-gray-border)",
};

export function TripTimeline({ events = [], style, ...rest }) {
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", ...style }} {...rest}>
      {events.map((e, i) => {
        const last = i === events.length - 1;
        const color = TONE[e.tone || (e.done === false ? "pending" : "done")];
        const pending = (e.tone || (e.done === false ? "pending" : "done")) === "pending";
        return (
          <li key={e.label + i} style={{ display: "grid", gridTemplateColumns: "24px 1fr", gap: "var(--space-3)" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "var(--radius-pill)",
                  background: pending ? "var(--surface-card)" : color,
                  border: "2px solid " + (pending ? "var(--border-default)" : color),
                  color: "var(--text-on-brand)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "0 0 auto",
                }}
              >
                {!pending && <Icon name={e.icon || "check"} size={12} strokeWidth={3} />}
              </span>
              {!last && <span style={{ flex: 1, width: 2, minHeight: 22, background: pending ? "var(--border-default)" : color, opacity: pending ? 1 : 0.35 }} />}
            </div>
            <div style={{ paddingBottom: last ? 0 : "var(--space-4)" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", flexWrap: "wrap" }}>
                <span style={{ font: "var(--type-label)", color: pending ? "var(--text-secondary)" : "var(--text-body)" }}>{e.label}</span>
                {e.time && <Identifier size="xs" tone="muted">{e.time}</Identifier>}
              </div>
              {e.detail && <p style={{ font: "var(--type-caption)", color: "var(--text-secondary)", marginTop: 2 }}>{e.detail}</p>}
              {e.meta && <div style={{ marginTop: "var(--space-2)" }}>{e.meta}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
