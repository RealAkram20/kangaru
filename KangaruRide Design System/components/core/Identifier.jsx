import React from "react";

export function Identifier({ children, kind = "plain", size = "sm", tone = "default", style, ...rest }) {
  const boxed = kind === "plate" || kind === "chip";
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontWeight: kind === "plate" ? "var(--weight-medium)" : "var(--weight-regular)",
        fontSize: size === "xs" ? "var(--text-xs)" : size === "md" ? "var(--text-base)" : "var(--text-sm)",
        letterSpacing: kind === "plate" ? "0.04em" : "0.01em",
        color: tone === "muted" ? "var(--text-secondary)" : tone === "inverse" ? "var(--text-on-chrome)" : "var(--text-body)",
        background: boxed ? (tone === "inverse" ? "var(--surface-chrome-elevated)" : "var(--surface-subtle)") : "transparent",
        border: boxed ? "1px solid " + (tone === "inverse" ? "var(--border-chrome)" : "var(--border-default)") : "none",
        borderRadius: boxed ? "var(--radius-sm)" : 0,
        padding: boxed ? "2px 6px" : 0,
        textTransform: kind === "plate" ? "uppercase" : "none",
        whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
