import React from "react";

export function FormField({ label, htmlFor, hint, error, required = false, children, style, ...rest }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, ...style }} {...rest}>
      {label && (
        <label htmlFor={htmlFor} style={{ font: "var(--type-label)", color: "var(--text-body)" }}>
          {label}
          {required && <span style={{ color: "var(--kr-error)", marginLeft: 3 }}>*</span>}
        </label>
      )}
      {children}
      {(error || hint) && (
        <p style={{ font: "var(--type-caption)", color: error ? "var(--kr-error)" : "var(--text-secondary)" }}>{error || hint}</p>
      )}
    </div>
  );
}
