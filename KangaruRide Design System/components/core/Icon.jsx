import React from "react";

/* Lucide icons are loaded from CDN (window.lucide UMD). See readme ICONOGRAPHY —
   the brand ships no icon set of its own; Lucide is the documented substitution
   because the product stack is shadcn/ui, whose icon dependency is lucide-react. */
function toPascal(name) {
  return name.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
}
function nodeToSvg(node) {
  // Tolerates both IconNode shapes: [[tag,attrs],…] and ["svg",attrs,[children]]
  let children = node;
  if (typeof node[0] === "string") children = node[2] || [];
  return children
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs || {})
        .map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
        .join(" ");
      return `<${tag} ${a} />`;
    })
    .join("");
}

export function Icon({ name, size = 20, strokeWidth = 2, color = "currentColor", title, style, ...rest }) {
  const set = (typeof window !== "undefined" && window.lucide && window.lucide.icons) || null;
  const node = set ? set[toPascal(name)] || set[name] : null;
  const box = { width: size, height: size, display: "inline-block", flex: "0 0 auto", verticalAlign: "middle" };
  if (!node) {
    return <span aria-hidden="true" style={{ ...box, borderRadius: 2, background: "currentColor", opacity: 0.18, ...style }} {...rest} />;
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : "true"}
      aria-label={title}
      style={{ ...box, ...style }}
      dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : "") + nodeToSvg(node) }}
      {...rest}
    />
  );
}
