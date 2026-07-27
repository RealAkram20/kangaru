import React from "react";

const FILES = {
  horizontal: "logo-horizontal.png",
  "horizontal-navy": "logo-horizontal-navy.png",
  stacked: "logo-stacked-light.png",
  mono: "logo-horizontal-mono.png",
  mark: "logo-mark.png",
  "mark-solid": "logo-mark-solid.png",
};

export function Logo({ variant = "horizontal", height = 32, basePath = "assets", withWordmark = false, style, ...rest }) {
  const src = `${basePath}/${FILES[variant] || FILES.horizontal}`;
  const isMark = variant.startsWith("mark");
  const img = (
    <img
      src={src}
      alt="KangaruRide"
      style={{ height, width: isMark ? height : "auto", display: "block", objectFit: "contain", ...(withWordmark ? {} : style) }}
      {...(withWordmark ? {} : rest)}
    />
  );
  if (!withWordmark || !isMark) return img;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", ...style }} {...rest}>
      {img}
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: "var(--weight-bold)",
          fontSize: Math.round(height * 0.55),
          letterSpacing: "var(--tracking-tight)",
          color: "inherit",
          whiteSpace: "nowrap",
        }}
      >
        KangaruRide
      </span>
    </span>
  );
}
