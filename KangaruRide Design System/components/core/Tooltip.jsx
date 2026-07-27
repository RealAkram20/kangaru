import React from "react";

export function Tooltip({ children, label, placement = "top", style, ...rest }) {
  const [open, setOpen] = React.useState(false);
  const pos =
    placement === "bottom"
      ? { top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" }
      : placement === "left"
      ? { right: "calc(100% + 6px)", top: "50%", transform: "translateY(-50%)" }
      : placement === "right"
      ? { left: "calc(100% + 6px)", top: "50%", transform: "translateY(-50%)" }
      : { bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" };
  return (
    <span
      style={{ position: "relative", display: "inline-flex", ...style }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      {...rest}
    >
      {children}
      <span
        role="tooltip"
        style={{
          position: "absolute",
          ...pos,
          background: "var(--surface-chrome)",
          color: "var(--text-on-chrome)",
          font: "var(--type-caption)",
          padding: "6px 8px",
          borderRadius: "var(--radius-sm)",
          boxShadow: "var(--shadow-md)",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          opacity: open ? 1 : 0,
          transition: "opacity var(--dur-fast) var(--ease-standard)",
          zIndex: 40,
        }}
      >
        {label}
      </span>
    </span>
  );
}
