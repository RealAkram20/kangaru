import React from "react";
import { Icon } from "./Icon.jsx";

const SIZES = { sm: 32, md: 40, lg: 48 };
const GLYPH = { sm: 16, md: 18, lg: 20 };

export function IconButton({ icon, label, size = "md", variant = "ghost", onChrome = false, disabled = false, onClick, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const box = SIZES[size] || SIZES.md;
  const filled = variant === "primary";
  const bg = filled
    ? hover && !disabled
      ? "var(--action-primary-hover)"
      : "var(--action-primary)"
    : hover && !disabled
    ? onChrome
      ? "var(--action-ghost-hover-bg-chrome)"
      : "var(--action-ghost-hover-bg)"
    : "transparent";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: box,
        height: box,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: bg,
        color: filled ? "var(--text-on-brand)" : onChrome ? "var(--text-on-chrome)" : "var(--text-secondary)",
        border: variant === "outline" ? "1px solid var(--border-default)" : "1px solid transparent",
        borderRadius: "var(--radius-control)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "var(--transition-control)",
        ...style,
      }}
      {...rest}
    >
      <Icon name={icon} size={GLYPH[size] || 18} />
    </button>
  );
}
