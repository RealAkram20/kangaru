import React from "react";
import { Icon } from "./Icon.jsx";

const TONES = {
  neutral: { fg: "var(--kr-neutral)", bg: "var(--kr-neutral-tint)" },
  success: { fg: "var(--kr-success)", bg: "var(--kr-success-tint)" },
  warning: { fg: "var(--kr-warning)", bg: "var(--kr-warning-tint)" },
  error: { fg: "var(--kr-error)", bg: "var(--kr-error-tint)" },
  info: { fg: "var(--kr-info)", bg: "var(--kr-info-tint)" },
  brand: { fg: "var(--kr-green-dark)", bg: "var(--kr-green-tint)" },
};

export function Badge({ children, tone = "neutral", icon, size = "md", outline = false, style, ...rest }) {
  const t = TONES[tone] || TONES.neutral;
  const sm = size === "sm";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: sm ? "1px 8px" : "3px 10px",
        borderRadius: "var(--radius-badge)",
        background: outline ? "transparent" : t.bg,
        color: t.fg,
        border: "1px solid " + (outline ? "currentColor" : "transparent"),
        font: "var(--type-caption)",
        fontWeight: "var(--weight-semibold)",
        fontSize: sm ? "11px" : "var(--text-xs)",
        whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    >
      {icon && <Icon name={icon} size={sm ? 11 : 12} strokeWidth={2.25} />}
      {children}
    </span>
  );
}
