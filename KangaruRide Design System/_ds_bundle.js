/* @ds-bundle: {"format":4,"namespace":"KangaruRideDesignSystem_69b541","components":[{"name":"Logo","sourcePath":"components/brand/Logo.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Identifier","sourcePath":"components/core/Identifier.jsx"},{"name":"TRIP_STATES","sourcePath":"components/core/StatusBadge.jsx"},{"name":"StatusBadge","sourcePath":"components/core/StatusBadge.jsx"},{"name":"Tooltip","sourcePath":"components/core/Tooltip.jsx"},{"name":"DataTable","sourcePath":"components/data/DataTable.jsx"},{"name":"KPIStat","sourcePath":"components/data/KPIStat.jsx"},{"name":"Pagination","sourcePath":"components/data/Pagination.jsx"},{"name":"TripTimeline","sourcePath":"components/data/TripTimeline.jsx"},{"name":"Alert","sourcePath":"components/feedback/Alert.jsx"},{"name":"Dialog","sourcePath":"components/feedback/Dialog.jsx"},{"name":"EmptyState","sourcePath":"components/feedback/EmptyState.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"FormField","sourcePath":"components/forms/FormField.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"RadioGroup","sourcePath":"components/forms/RadioGroup.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Breadcrumbs","sourcePath":"components/navigation/Breadcrumbs.jsx"},{"name":"SidebarNav","sourcePath":"components/navigation/SidebarNav.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"},{"name":"Topbar","sourcePath":"components/navigation/Topbar.jsx"}],"sourceHashes":{"components/brand/Logo.jsx":"1fa3119f6bf2","components/core/Badge.jsx":"ab5450c5799a","components/core/Button.jsx":"408f328981be","components/core/Card.jsx":"9148261ca610","components/core/Icon.jsx":"593c816270b2","components/core/IconButton.jsx":"f7d724444cd5","components/core/Identifier.jsx":"826b8e022cde","components/core/StatusBadge.jsx":"46fd802bb187","components/core/Tooltip.jsx":"84162984b310","components/data/DataTable.jsx":"37672c0c22a1","components/data/KPIStat.jsx":"49db7123489b","components/data/Pagination.jsx":"d55eeb842926","components/data/TripTimeline.jsx":"16c51dd27329","components/feedback/Alert.jsx":"b257d08ba958","components/feedback/Dialog.jsx":"e348b8b49d49","components/feedback/EmptyState.jsx":"3ae244af071d","components/forms/Checkbox.jsx":"ace5706efcf5","components/forms/FormField.jsx":"f242c2e53eff","components/forms/Input.jsx":"0030c2d5ee33","components/forms/RadioGroup.jsx":"80ebda1838d8","components/forms/Select.jsx":"5179e884645e","components/forms/Switch.jsx":"6c5419d03ed5","components/navigation/Breadcrumbs.jsx":"ec15244bcce7","components/navigation/SidebarNav.jsx":"fdaebceac9a0","components/navigation/Tabs.jsx":"c482bf35626f","components/navigation/Topbar.jsx":"f3d4fe67a01e","ui_kits/driver-web/DriverFlow.jsx":"e1cc12435142","ui_kits/platform/BillingScreen.jsx":"075f84ba1f70","ui_kits/platform/DashboardScreen.jsx":"5465723a7428","ui_kits/platform/DispatchScreen.jsx":"c9c638296286","ui_kits/platform/LoginScreen.jsx":"d0bf2084337e","ui_kits/platform/TripDetailScreen.jsx":"c27a7fd76d52","ui_kits/platform/shared.jsx":"d7a455e7c55e","ui_kits/website/BookingScreen.jsx":"a283f97c9743","ui_kits/website/HomeScreen.jsx":"11659323f500","ui_kits/website/shared.jsx":"d8d59ae91797"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.KangaruRideDesignSystem_69b541 = window.KangaruRideDesignSystem_69b541 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/brand/Logo.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const FILES = {
  horizontal: "logo-horizontal.png",
  "horizontal-navy": "logo-horizontal-navy.png",
  stacked: "logo-stacked-light.png",
  mono: "logo-horizontal-mono.png",
  mark: "logo-mark.png",
  "mark-solid": "logo-mark-solid.png"
};
function Logo({
  variant = "horizontal",
  height = 32,
  basePath = "assets",
  withWordmark = false,
  style,
  ...rest
}) {
  const src = `${basePath}/${FILES[variant] || FILES.horizontal}`;
  const isMark = variant.startsWith("mark");
  const img = /*#__PURE__*/React.createElement("img", _extends({
    src: src,
    alt: "KangaruRide",
    style: {
      height,
      width: isMark ? height : "auto",
      display: "block",
      objectFit: "contain",
      ...(withWordmark ? {} : style)
    }
  }, withWordmark ? {} : rest));
  if (!withWordmark || !isMark) return img;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--space-2)",
      ...style
    }
  }, rest), img, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-display)",
      fontWeight: "var(--weight-bold)",
      fontSize: Math.round(height * 0.55),
      letterSpacing: "var(--tracking-tight)",
      color: "inherit",
      whiteSpace: "nowrap"
    }
  }, "KangaruRide"));
}
Object.assign(__ds_scope, { Logo });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/Logo.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Card({
  children,
  title,
  subtitle,
  actions,
  padding = "md",
  tone = "default",
  style,
  bodyStyle,
  ...rest
}) {
  const pad = padding === "none" ? 0 : padding === "sm" ? "var(--pad-card-compact)" : "var(--pad-card)";
  const tones = {
    default: {
      background: "var(--surface-card)",
      border: "1px solid var(--border-default)"
    },
    accent: {
      background: "var(--surface-accent)",
      border: "1px solid var(--kr-green-tint)"
    },
    sunken: {
      background: "var(--surface-sunken)",
      border: "1px solid var(--border-default)"
    },
    chrome: {
      background: "var(--surface-chrome-elevated)",
      border: "1px solid var(--border-chrome)"
    }
  };
  const onChrome = tone === "chrome";
  return /*#__PURE__*/React.createElement("section", _extends({
    style: {
      borderRadius: "var(--radius-card)",
      boxShadow: "var(--shadow-xs)",
      overflow: "hidden",
      ...tones[tone],
      ...style
    }
  }, rest), (title || actions) && /*#__PURE__*/React.createElement("header", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "var(--space-4)",
      padding: `var(--space-4) ${padding === "none" ? "var(--space-4)" : pad}`,
      borderBottom: "1px solid " + (onChrome ? "var(--border-chrome)" : "var(--border-default)")
    }
  }, /*#__PURE__*/React.createElement("div", null, title && /*#__PURE__*/React.createElement("h2", {
    style: {
      font: "var(--type-section-title)",
      color: onChrome ? "var(--text-on-chrome)" : "var(--text-heading)",
      letterSpacing: "var(--tracking-tight)"
    }
  }, title), subtitle && /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-body-dense)",
      color: onChrome ? "var(--text-on-chrome-secondary)" : "var(--text-secondary)",
      marginTop: 2
    }
  }, subtitle)), actions && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--gap-inline)"
    }
  }, actions)), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: pad,
      ...bodyStyle
    }
  }, children));
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
  return children.map(([tag, attrs]) => {
    const a = Object.entries(attrs || {}).map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`).join(" ");
    return `<${tag} ${a} />`;
  }).join("");
}
function Icon({
  name,
  size = 20,
  strokeWidth = 2,
  color = "currentColor",
  title,
  style,
  ...rest
}) {
  const set = typeof window !== "undefined" && window.lucide && window.lucide.icons || null;
  const node = set ? set[toPascal(name)] || set[name] : null;
  const box = {
    width: size,
    height: size,
    display: "inline-block",
    flex: "0 0 auto",
    verticalAlign: "middle"
  };
  if (!node) {
    return /*#__PURE__*/React.createElement("span", _extends({
      "aria-hidden": "true",
      style: {
        ...box,
        borderRadius: 2,
        background: "currentColor",
        opacity: 0.18,
        ...style
      }
    }, rest));
  }
  return /*#__PURE__*/React.createElement("svg", _extends({
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    role: title ? "img" : "presentation",
    "aria-hidden": title ? undefined : "true",
    "aria-label": title,
    style: {
      ...box,
      ...style
    },
    dangerouslySetInnerHTML: {
      __html: (title ? `<title>${title}</title>` : "") + nodeToSvg(node)
    }
  }, rest));
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const TONES = {
  neutral: {
    fg: "var(--kr-neutral)",
    bg: "var(--kr-neutral-tint)"
  },
  success: {
    fg: "var(--kr-success)",
    bg: "var(--kr-success-tint)"
  },
  warning: {
    fg: "var(--kr-warning)",
    bg: "var(--kr-warning-tint)"
  },
  error: {
    fg: "var(--kr-error)",
    bg: "var(--kr-error-tint)"
  },
  info: {
    fg: "var(--kr-info)",
    bg: "var(--kr-info-tint)"
  },
  brand: {
    fg: "var(--kr-green-dark)",
    bg: "var(--kr-green-tint)"
  }
};
function Badge({
  children,
  tone = "neutral",
  icon,
  size = "md",
  outline = false,
  style,
  ...rest
}) {
  const t = TONES[tone] || TONES.neutral;
  const sm = size === "sm";
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
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
      ...style
    }
  }, rest), icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: sm ? 11 : 12,
    strokeWidth: 2.25
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  sm: {
    height: "var(--control-h-sm)",
    padding: "0 12px",
    fontSize: "13px",
    gap: 6,
    icon: 14
  },
  md: {
    height: "var(--control-h-md)",
    padding: "0 16px",
    fontSize: "var(--text-sm)",
    gap: 8,
    icon: 16
  },
  lg: {
    height: "var(--control-h-lg)",
    padding: "0 24px",
    fontSize: "var(--text-base)",
    gap: 8,
    icon: 18
  }
};
function paint(variant, hover, onChrome) {
  if (variant === "primary") return {
    background: hover ? "var(--action-primary-hover)" : "var(--action-primary)",
    color: "var(--text-on-brand)",
    border: "1px solid transparent"
  };
  if (variant === "secondary") return {
    background: hover ? "var(--action-secondary-hover-bg)" : "transparent",
    color: "var(--action-secondary-text)",
    border: "1px solid var(--border-default)"
  };
  if (variant === "destructive") return {
    background: hover ? "var(--action-destructive-hover)" : "var(--action-destructive)",
    color: "var(--text-on-brand)",
    border: "1px solid transparent"
  };
  return {
    background: hover ? onChrome ? "var(--action-ghost-hover-bg-chrome)" : "var(--action-ghost-hover-bg)" : "transparent",
    color: onChrome ? "var(--text-on-chrome)" : "var(--text-body)",
    border: "1px solid transparent"
  };
}
function Button({
  children,
  variant = "primary",
  size = "md",
  iconLeft,
  iconRight,
  disabled = false,
  loading = false,
  fullWidth = false,
  onChrome = false,
  type = "button",
  onClick,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const s = SIZES[size] || SIZES.md;
  const skin = paint(variant, hover && !disabled, onChrome);
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled || loading,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: fullWidth ? "flex" : "inline-flex",
      width: fullWidth ? "100%" : undefined,
      alignItems: "center",
      justifyContent: "center",
      gap: s.gap,
      height: s.height,
      padding: s.padding,
      fontFamily: "var(--font-sans)",
      fontWeight: "var(--weight-semibold)",
      fontSize: s.fontSize,
      lineHeight: 1,
      borderRadius: "var(--radius-control)",
      cursor: disabled || loading ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
      transition: "var(--transition-control)",
      whiteSpace: "nowrap",
      ...skin,
      ...style
    }
  }, rest), loading ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "loader-circle",
    size: s.icon
  }) : iconLeft ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: iconLeft,
    size: s.icon
  }) : null, children, iconRight ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: iconRight,
    size: s.icon
  }) : null);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  sm: 32,
  md: 40,
  lg: 48
};
const GLYPH = {
  sm: 16,
  md: 18,
  lg: 20
};
function IconButton({
  icon,
  label,
  size = "md",
  variant = "ghost",
  onChrome = false,
  disabled = false,
  onClick,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const box = SIZES[size] || SIZES.md;
  const filled = variant === "primary";
  const bg = filled ? hover && !disabled ? "var(--action-primary-hover)" : "var(--action-primary)" : hover && !disabled ? onChrome ? "var(--action-ghost-hover-bg-chrome)" : "var(--action-ghost-hover-bg)" : "transparent";
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-label": label,
    title: label,
    disabled: disabled,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
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
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: GLYPH[size] || 18
  }));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Identifier.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Identifier({
  children,
  kind = "plain",
  size = "sm",
  tone = "default",
  style,
  ...rest
}) {
  const boxed = kind === "plate" || kind === "chip";
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      fontFamily: "var(--font-mono)",
      fontWeight: kind === "plate" ? "var(--weight-medium)" : "var(--weight-regular)",
      fontSize: size === "xs" ? "var(--text-xs)" : size === "md" ? "var(--text-base)" : "var(--text-sm)",
      letterSpacing: kind === "plate" ? "0.04em" : "0.01em",
      color: tone === "muted" ? "var(--text-secondary)" : tone === "inverse" ? "var(--text-on-chrome)" : "var(--text-body)",
      background: boxed ? tone === "inverse" ? "var(--surface-chrome-elevated)" : "var(--surface-subtle)" : "transparent",
      border: boxed ? "1px solid " + (tone === "inverse" ? "var(--border-chrome)" : "var(--border-default)") : "none",
      borderRadius: boxed ? "var(--radius-sm)" : 0,
      padding: boxed ? "2px 6px" : 0,
      textTransform: kind === "plate" ? "uppercase" : "none",
      whiteSpace: "nowrap",
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Identifier });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Identifier.jsx", error: String((e && e.message) || e) }); }

// components/core/StatusBadge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* The trip lifecycle from PROJECT.md, plus finance states. Keys are lowercase,
   space or underscore insensitive, so "Trip Started" and "trip_started" both work. */
const TRIP_STATES = {
  booking_created: {
    label: "Booking created",
    tone: "neutral",
    icon: "file-plus"
  },
  approved: {
    label: "Approved",
    tone: "info",
    icon: "check"
  },
  assigned: {
    label: "Assigned",
    tone: "info",
    icon: "user-check"
  },
  rejected: {
    label: "Rejected",
    tone: "error",
    icon: "user-x"
  },
  accepted: {
    label: "Accepted",
    tone: "info",
    icon: "check-check"
  },
  driver_en_route: {
    label: "En route",
    tone: "info",
    icon: "navigation"
  },
  driver_arrived: {
    label: "Arrived",
    tone: "info",
    icon: "map-pin"
  },
  no_show: {
    label: "No show",
    tone: "error",
    icon: "user-round-x"
  },
  passenger_onboard: {
    label: "Onboard",
    tone: "brand",
    icon: "users"
  },
  trip_started: {
    label: "In progress",
    tone: "brand",
    icon: "play"
  },
  waiting: {
    label: "Waiting",
    tone: "warning",
    icon: "pause"
  },
  trip_completed: {
    label: "Completed",
    tone: "success",
    icon: "circle-check"
  },
  invoice_generated: {
    label: "Invoiced",
    tone: "info",
    icon: "receipt"
  },
  disputed: {
    label: "Disputed",
    tone: "warning",
    icon: "triangle-alert"
  },
  closed: {
    label: "Closed",
    tone: "neutral",
    icon: "lock"
  },
  cancelled: {
    label: "Cancelled",
    tone: "error",
    icon: "circle-x"
  },
  flagged: {
    label: "Variance flagged",
    tone: "warning",
    icon: "triangle-alert"
  },
  paid: {
    label: "Paid",
    tone: "success",
    icon: "circle-check"
  },
  overdue: {
    label: "Overdue",
    tone: "error",
    icon: "clock-alert"
  },
  draft: {
    label: "Draft",
    tone: "neutral",
    icon: "pencil"
  }
};
function StatusBadge({
  state,
  label,
  size = "md",
  style,
  ...rest
}) {
  const key = String(state || "").toLowerCase().replace(/[\s-]+/g, "_");
  const def = TRIP_STATES[key] || {
    label: label || state,
    tone: "neutral",
    icon: "circle"
  };
  return /*#__PURE__*/React.createElement(__ds_scope.Badge, _extends({
    tone: def.tone,
    icon: def.icon,
    size: size,
    style: style
  }, rest), label || def.label);
}
Object.assign(__ds_scope, { TRIP_STATES, StatusBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/StatusBadge.jsx", error: String((e && e.message) || e) }); }

// components/core/Tooltip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Tooltip({
  children,
  label,
  placement = "top",
  style,
  ...rest
}) {
  const [open, setOpen] = React.useState(false);
  const pos = placement === "bottom" ? {
    top: "calc(100% + 6px)",
    left: "50%",
    transform: "translateX(-50%)"
  } : placement === "left" ? {
    right: "calc(100% + 6px)",
    top: "50%",
    transform: "translateY(-50%)"
  } : placement === "right" ? {
    left: "calc(100% + 6px)",
    top: "50%",
    transform: "translateY(-50%)"
  } : {
    bottom: "calc(100% + 6px)",
    left: "50%",
    transform: "translateX(-50%)"
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      position: "relative",
      display: "inline-flex",
      ...style
    },
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false)
  }, rest), children, /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    style: {
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
      zIndex: 40
    }
  }, label));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/data/DataTable.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function DataTable({
  columns = [],
  rows = [],
  dense = false,
  selectable = false,
  onRowClick,
  emptyMessage = "No records",
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(null);
  const [sort, setSort] = React.useState(null);
  const pad = dense ? "var(--pad-cell-dense) var(--space-3)" : "var(--pad-cell) var(--space-4)";
  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const col = columns.find(c => c.key === sort.key);
    if (!col) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => String(a[sort.key]) > String(b[sort.key]) ? dir : -dir);
  }, [rows, sort, columns]);
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      width: "100%",
      overflowX: "auto",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("table", {
    style: {
      width: "100%",
      borderCollapse: "collapse",
      font: dense ? "var(--type-body-dense)" : "var(--type-body-dense)"
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      background: "var(--surface-sunken)"
    }
  }, selectable && /*#__PURE__*/React.createElement("th", {
    style: {
      width: 40,
      padding: pad,
      borderBottom: "1px solid var(--border-default)"
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    "aria-label": "Select all"
  })), columns.map(c => /*#__PURE__*/React.createElement("th", {
    key: c.key,
    onClick: () => c.sortable && setSort(s => ({
      key: c.key,
      dir: s && s.key === c.key && s.dir === "asc" ? "desc" : "asc"
    })),
    style: {
      textAlign: c.align || "left",
      padding: pad,
      font: "var(--type-overline)",
      textTransform: "uppercase",
      letterSpacing: "var(--tracking-caps)",
      color: "var(--text-secondary)",
      borderBottom: "1px solid var(--border-default)",
      whiteSpace: "nowrap",
      width: c.width,
      cursor: c.sortable ? "pointer" : "default",
      userSelect: "none"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4
    }
  }, c.header, c.sortable && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: sort && sort.key === c.key ? sort.dir === "asc" ? "arrow-up" : "arrow-down" : "chevrons-up-down",
    size: 12,
    style: {
      color: sort && sort.key === c.key ? "var(--text-accent)" : "var(--text-placeholder)"
    }
  })))))), /*#__PURE__*/React.createElement("tbody", null, sorted.length === 0 && /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("td", {
    colSpan: columns.length + (selectable ? 1 : 0),
    style: {
      padding: "var(--space-10)",
      textAlign: "center",
      color: "var(--text-secondary)"
    }
  }, emptyMessage)), sorted.map((row, ri) => /*#__PURE__*/React.createElement("tr", {
    key: row.id || ri,
    onMouseEnter: () => setHover(ri),
    onMouseLeave: () => setHover(null),
    onClick: () => onRowClick && onRowClick(row),
    style: {
      background: hover === ri ? "var(--surface-sunken)" : "transparent",
      cursor: onRowClick ? "pointer" : "default",
      transition: "background-color var(--dur-fast) var(--ease-standard)"
    }
  }, selectable && /*#__PURE__*/React.createElement("td", {
    style: {
      padding: pad,
      borderBottom: "1px solid var(--border-default)"
    }
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    "aria-label": "Select row",
    onClick: e => e.stopPropagation()
  })), columns.map(c => /*#__PURE__*/React.createElement("td", {
    key: c.key,
    className: c.numeric ? "kr-tabular" : undefined,
    style: {
      padding: pad,
      textAlign: c.align || (c.numeric ? "right" : "left"),
      borderBottom: "1px solid var(--border-default)",
      color: "var(--text-body)",
      whiteSpace: c.wrap ? "normal" : "nowrap",
      fontVariantNumeric: c.numeric ? "tabular-nums" : "normal"
    }
  }, c.render ? c.render(row) : row[c.key])))))));
}
Object.assign(__ds_scope, { DataTable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/DataTable.jsx", error: String((e && e.message) || e) }); }

// components/data/KPIStat.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function KPIStat({
  label,
  value,
  unit,
  delta,
  deltaDirection = "up",
  icon,
  tone = "default",
  hint,
  style,
  ...rest
}) {
  const good = deltaDirection === "up";
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-2)",
      padding: "var(--pad-card-compact)",
      background: tone === "accent" ? "var(--surface-accent)" : "var(--surface-card)",
      border: "1px solid " + (tone === "accent" ? "var(--kr-green-tint)" : "var(--border-default)"),
      borderRadius: "var(--radius-card)",
      boxShadow: "var(--shadow-xs)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "var(--space-2)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-label)",
      color: "var(--text-secondary)"
    }
  }, label), icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 16,
    style: {
      color: "var(--text-accent)"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-kpi)",
      fontSize: "var(--text-3xl)",
      color: "var(--text-heading)",
      fontVariantNumeric: "tabular-nums"
    }
  }, value), unit && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-label)",
      color: "var(--text-secondary)"
    }
  }, unit)), (delta || hint) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, delta && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 3,
      font: "var(--type-caption)",
      fontWeight: "var(--weight-semibold)",
      color: good ? "var(--kr-success)" : "var(--kr-error)"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: good ? "trending-up" : "trending-down",
    size: 12,
    strokeWidth: 2.5
  }), delta), hint && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-secondary)"
    }
  }, hint)));
}
Object.assign(__ds_scope, { KPIStat });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/KPIStat.jsx", error: String((e && e.message) || e) }); }

// components/data/Pagination.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Pagination({
  page = 1,
  pageCount = 1,
  pageSize,
  total,
  onPageChange,
  style,
  ...rest
}) {
  const btn = (dir, icon, disabled) => /*#__PURE__*/React.createElement("button", {
    onClick: () => !disabled && onPageChange && onPageChange(page + dir),
    disabled: disabled,
    "aria-label": dir < 0 ? "Previous page" : "Next page",
    style: {
      width: 32,
      height: 32,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--surface-card)",
      border: "1px solid var(--border-default)",
      borderRadius: "var(--radius-control)",
      color: disabled ? "var(--text-disabled)" : "var(--text-body)",
      cursor: disabled ? "not-allowed" : "pointer"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 16
  }));
  const from = pageSize ? (page - 1) * pageSize + 1 : null;
  const to = pageSize && total ? Math.min(page * pageSize, total) : null;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "var(--space-4)",
      padding: "var(--space-3) var(--space-4)",
      borderTop: "1px solid var(--border-default)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    className: "kr-tabular",
    style: {
      font: "var(--type-caption)",
      color: "var(--text-secondary)"
    }
  }, from && to && total ? `${from}–${to} of ${total}` : `Page ${page} of ${pageCount}`), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-2)"
    }
  }, btn(-1, "chevron-left", page <= 1), /*#__PURE__*/React.createElement("span", {
    className: "kr-tabular",
    style: {
      font: "var(--type-label)",
      color: "var(--text-body)",
      minWidth: 64,
      textAlign: "center"
    }
  }, page, " / ", pageCount), btn(1, "chevron-right", page >= pageCount)));
}
Object.assign(__ds_scope, { Pagination });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Pagination.jsx", error: String((e && e.message) || e) }); }

// components/data/TripTimeline.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const TONE = {
  done: "var(--kr-success)",
  active: "var(--action-primary)",
  warning: "var(--kr-warning)",
  error: "var(--kr-error)",
  pending: "var(--kr-gray-border)"
};
function TripTimeline({
  events = [],
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("ol", _extends({
    style: {
      listStyle: "none",
      margin: 0,
      padding: 0,
      display: "flex",
      flexDirection: "column",
      ...style
    }
  }, rest), events.map((e, i) => {
    const last = i === events.length - 1;
    const color = TONE[e.tone || (e.done === false ? "pending" : "done")];
    const pending = (e.tone || (e.done === false ? "pending" : "done")) === "pending";
    return /*#__PURE__*/React.createElement("li", {
      key: e.label + i,
      style: {
        display: "grid",
        gridTemplateColumns: "24px 1fr",
        gap: "var(--space-3)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 22,
        height: 22,
        borderRadius: "var(--radius-pill)",
        background: pending ? "var(--surface-card)" : color,
        border: "2px solid " + (pending ? "var(--border-default)" : color),
        color: "var(--text-on-brand)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 auto"
      }
    }, !pending && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: e.icon || "check",
      size: 12,
      strokeWidth: 3
    })), !last && /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        width: 2,
        minHeight: 22,
        background: pending ? "var(--border-default)" : color,
        opacity: pending ? 1 : 0.35
      }
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        paddingBottom: last ? 0 : "var(--space-4)"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "baseline",
        gap: "var(--space-2)",
        flexWrap: "wrap"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--type-label)",
        color: pending ? "var(--text-secondary)" : "var(--text-body)"
      }
    }, e.label), e.time && /*#__PURE__*/React.createElement(__ds_scope.Identifier, {
      size: "xs",
      tone: "muted"
    }, e.time)), e.detail && /*#__PURE__*/React.createElement("p", {
      style: {
        font: "var(--type-caption)",
        color: "var(--text-secondary)",
        marginTop: 2
      }
    }, e.detail), e.meta && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: "var(--space-2)"
      }
    }, e.meta)));
  }));
}
Object.assign(__ds_scope, { TripTimeline });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/TripTimeline.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Alert.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const TONES = {
  info: {
    fg: "var(--kr-info)",
    bg: "var(--kr-info-tint)",
    icon: "info"
  },
  success: {
    fg: "var(--kr-success)",
    bg: "var(--kr-success-tint)",
    icon: "circle-check"
  },
  warning: {
    fg: "var(--kr-warning)",
    bg: "var(--kr-warning-tint)",
    icon: "triangle-alert"
  },
  error: {
    fg: "var(--kr-error)",
    bg: "var(--kr-error-tint)",
    icon: "circle-alert"
  }
};
function Alert({
  tone = "info",
  title,
  children,
  action,
  onDismiss,
  style,
  ...rest
}) {
  const t = TONES[tone] || TONES.info;
  return /*#__PURE__*/React.createElement("div", _extends({
    role: tone === "error" ? "alert" : "status",
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: "var(--space-3)",
      padding: "var(--space-3) var(--space-4)",
      background: t.bg,
      border: "1px solid " + t.fg,
      borderRadius: "var(--radius-md)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: t.icon,
    size: 18,
    style: {
      color: t.fg,
      marginTop: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, title && /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-label)",
      fontWeight: "var(--weight-semibold)",
      color: t.fg
    }
  }, title), children && /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--type-body-dense)",
      color: "var(--text-body)",
      marginTop: title ? 2 : 0
    }
  }, children)), action, onDismiss && /*#__PURE__*/React.createElement("button", {
    onClick: onDismiss,
    "aria-label": "Dismiss",
    style: {
      border: "none",
      background: "transparent",
      color: t.fg,
      cursor: "pointer",
      padding: 0
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "x",
    size: 16
  })));
}
Object.assign(__ds_scope, { Alert });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Alert.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Dialog.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Dialog({
  open = true,
  title,
  description,
  children,
  footer,
  onClose,
  width = 520,
  tone = "default",
  style,
  ...rest
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    role: "presentation",
    onClick: onClose,
    style: {
      position: "fixed",
      inset: 0,
      background: "var(--overlay-scrim)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "var(--space-6)",
      zIndex: 60
    }
  }, /*#__PURE__*/React.createElement("div", _extends({
    role: "dialog",
    "aria-modal": "true",
    "aria-label": title,
    onClick: e => e.stopPropagation(),
    style: {
      width: "100%",
      maxWidth: width,
      background: "var(--surface-card)",
      borderRadius: "var(--radius-modal)",
      boxShadow: "var(--shadow-modal)",
      overflow: "hidden",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: "var(--space-3)",
      padding: "var(--space-6) var(--space-6) var(--space-4)"
    }
  }, tone !== "default" && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 36,
      height: 36,
      flex: "0 0 auto",
      borderRadius: "var(--radius-pill)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      background: tone === "destructive" ? "var(--kr-error-tint)" : "var(--kr-warning-tint)",
      color: tone === "destructive" ? "var(--kr-error)" : "var(--kr-warning)"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "triangle-alert",
    size: 18
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, title && /*#__PURE__*/React.createElement("h2", {
    style: {
      font: "var(--type-section-title)",
      color: "var(--text-heading)",
      letterSpacing: "var(--tracking-tight)"
    }
  }, title), description && /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-body-dense)",
      color: "var(--text-secondary)",
      marginTop: 6
    }
  }, description)), onClose && /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    "aria-label": "Close",
    style: {
      border: "none",
      background: "transparent",
      color: "var(--text-secondary)",
      cursor: "pointer",
      padding: 2
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "x",
    size: 18
  }))), children && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "0 var(--space-6) var(--space-6)"
    }
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "flex-end",
      gap: "var(--gap-inline)",
      padding: "var(--space-4) var(--space-6)",
      background: "var(--surface-sunken)",
      borderTop: "1px solid var(--border-default)"
    }
  }, footer)));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/feedback/EmptyState.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function EmptyState({
  icon = "inbox",
  title,
  description,
  action,
  compact = false,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      gap: "var(--space-2)",
      padding: compact ? "var(--space-8) var(--space-6)" : "var(--space-16) var(--space-6)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 44,
      height: 44,
      borderRadius: "var(--radius-pill)",
      background: "var(--surface-accent)",
      color: "var(--text-accent)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: "var(--space-2)"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 20
  })), title && /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-label)",
      fontWeight: "var(--weight-semibold)",
      fontSize: "var(--text-base)",
      color: "var(--text-heading)"
    }
  }, title), description && /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-body-dense)",
      color: "var(--text-secondary)",
      maxWidth: 360
    }
  }, description), action && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--space-3)"
    }
  }, action));
}
Object.assign(__ds_scope, { EmptyState });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/EmptyState.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Checkbox({
  checked,
  defaultChecked,
  onChange,
  label,
  description,
  disabled = false,
  indeterminate = false,
  id,
  style,
  ...rest
}) {
  const [internal, setInternal] = React.useState(!!defaultChecked);
  const on = checked === undefined ? internal : checked;
  const toggle = () => {
    if (disabled) return;
    if (checked === undefined) setInternal(!on);
    onChange && onChange(!on);
  };
  return /*#__PURE__*/React.createElement("label", _extends({
    htmlFor: id,
    onClick: e => {
      e.preventDefault();
      toggle();
    },
    style: {
      display: "inline-flex",
      alignItems: description ? "flex-start" : "center",
      gap: "var(--space-2)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    role: "checkbox",
    "aria-checked": indeterminate ? "mixed" : on,
    tabIndex: disabled ? -1 : 0,
    onKeyDown: e => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        toggle();
      }
    },
    style: {
      width: 18,
      height: 18,
      flex: "0 0 auto",
      marginTop: description ? 1 : 0,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: "var(--radius-sm)",
      background: on || indeterminate ? "var(--action-primary)" : "var(--surface-card)",
      border: "1px solid " + (on || indeterminate ? "var(--action-primary)" : "var(--border-input)"),
      color: "var(--text-on-brand)",
      transition: "var(--transition-control)"
    }
  }, indeterminate ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "minus",
    size: 12,
    strokeWidth: 3
  }) : on ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "check",
    size: 12,
    strokeWidth: 3
  }) : null), (label || description) && /*#__PURE__*/React.createElement("span", null, label && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-body-dense)",
      color: "var(--text-body)"
    }
  }, label), description && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      font: "var(--type-caption)",
      color: "var(--text-secondary)",
      marginTop: 2
    }
  }, description)));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/FormField.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function FormField({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  children,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6,
      ...style
    }
  }, rest), label && /*#__PURE__*/React.createElement("label", {
    htmlFor: htmlFor,
    style: {
      font: "var(--type-label)",
      color: "var(--text-body)"
    }
  }, label, required && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--kr-error)",
      marginLeft: 3
    }
  }, "*")), children, (error || hint) && /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-caption)",
      color: error ? "var(--kr-error)" : "var(--text-secondary)"
    }
  }, error || hint));
}
Object.assign(__ds_scope, { FormField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/FormField.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Input({
  value,
  defaultValue,
  onChange,
  placeholder,
  type = "text",
  size = "md",
  iconLeft,
  iconRight,
  mono = false,
  invalid = false,
  disabled = false,
  readOnly = false,
  suffix,
  id,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const h = size === "sm" ? "var(--control-h-sm)" : size === "lg" ? "var(--control-h-lg)" : "var(--control-h-md)";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-2)",
      height: h,
      padding: "0 12px",
      background: disabled ? "var(--surface-subtle)" : "var(--surface-card)",
      border: "1px solid " + (invalid ? "var(--kr-error)" : focus ? "var(--action-primary)" : "var(--border-input)"),
      borderRadius: "var(--radius-input)",
      boxShadow: focus ? "0 0 0 3px rgba(1,144,61,.16)" : "none",
      transition: "var(--transition-control)",
      opacity: disabled ? 0.7 : 1,
      ...style
    }
  }, iconLeft && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: iconLeft,
    size: 16,
    style: {
      color: "var(--text-placeholder)"
    }
  }), /*#__PURE__*/React.createElement("input", _extends({
    id: id,
    type: type,
    value: value,
    defaultValue: defaultValue,
    onChange: onChange,
    placeholder: placeholder,
    disabled: disabled,
    readOnly: readOnly,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      flex: 1,
      minWidth: 0,
      border: "none",
      outline: "none",
      background: "transparent",
      font: mono ? "var(--type-identifier)" : size === "lg" ? "var(--type-body)" : "var(--type-body-dense)",
      color: "var(--text-body)",
      fontVariantNumeric: type === "number" || mono ? "tabular-nums" : "normal"
    }
  }, rest)), suffix && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-secondary)"
    }
  }, suffix), iconRight && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: iconRight,
    size: 16,
    style: {
      color: "var(--text-placeholder)"
    }
  }));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/RadioGroup.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function RadioGroup({
  value,
  defaultValue,
  onChange,
  options = [],
  name,
  layout = "vertical",
  disabled = false,
  style,
  ...rest
}) {
  const [internal, setInternal] = React.useState(defaultValue);
  const current = value === undefined ? internal : value;
  const pick = v => {
    if (disabled) return;
    if (value === undefined) setInternal(v);
    onChange && onChange(v);
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "radiogroup",
    style: {
      display: "flex",
      flexDirection: layout === "horizontal" ? "row" : "column",
      gap: layout === "horizontal" ? "var(--space-6)" : "var(--space-3)",
      ...style
    }
  }, rest), options.map(o => {
    const opt = typeof o === "string" ? {
      value: o,
      label: o
    } : o;
    const on = current === opt.value;
    return /*#__PURE__*/React.createElement("label", {
      key: opt.value,
      onClick: () => pick(opt.value),
      style: {
        display: "inline-flex",
        alignItems: opt.description ? "flex-start" : "center",
        gap: "var(--space-2)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "radio",
      name: name,
      checked: on,
      readOnly: true,
      style: {
        position: "absolute",
        opacity: 0,
        width: 0,
        height: 0
      }
    }), /*#__PURE__*/React.createElement("span", {
      role: "radio",
      "aria-checked": on,
      tabIndex: disabled ? -1 : 0,
      onKeyDown: e => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          pick(opt.value);
        }
      },
      style: {
        width: 18,
        height: 18,
        flex: "0 0 auto",
        marginTop: opt.description ? 1 : 0,
        borderRadius: "var(--radius-pill)",
        border: "1px solid " + (on ? "var(--action-primary)" : "var(--border-input)"),
        background: "var(--surface-card)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "var(--transition-control)"
      }
    }, on && /*#__PURE__*/React.createElement("span", {
      style: {
        width: 8,
        height: 8,
        borderRadius: "var(--radius-pill)",
        background: "var(--action-primary)"
      }
    })), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--type-body-dense)",
        color: "var(--text-body)"
      }
    }, opt.label), opt.description && /*#__PURE__*/React.createElement("span", {
      style: {
        display: "block",
        font: "var(--type-caption)",
        color: "var(--text-secondary)",
        marginTop: 2
      }
    }, opt.description)));
  }));
}
Object.assign(__ds_scope, { RadioGroup });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/RadioGroup.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Select({
  value,
  defaultValue,
  onChange,
  options = [],
  placeholder,
  size = "md",
  invalid = false,
  disabled = false,
  id,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const h = size === "sm" ? "var(--control-h-sm)" : size === "lg" ? "var(--control-h-lg)" : "var(--control-h-md)";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      display: "flex",
      alignItems: "center",
      height: h,
      background: disabled ? "var(--surface-subtle)" : "var(--surface-card)",
      border: "1px solid " + (invalid ? "var(--kr-error)" : focus ? "var(--action-primary)" : "var(--border-input)"),
      borderRadius: "var(--radius-input)",
      boxShadow: focus ? "0 0 0 3px rgba(1,144,61,.16)" : "none",
      transition: "var(--transition-control)",
      opacity: disabled ? 0.7 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    id: id,
    value: value,
    defaultValue: defaultValue,
    onChange: onChange,
    disabled: disabled,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      appearance: "none",
      WebkitAppearance: "none",
      flex: 1,
      height: "100%",
      padding: "0 34px 0 12px",
      border: "none",
      outline: "none",
      background: "transparent",
      font: size === "lg" ? "var(--type-body)" : "var(--type-body-dense)",
      color: value || defaultValue ? "var(--text-body)" : "var(--text-placeholder)",
      cursor: disabled ? "not-allowed" : "pointer"
    }
  }, rest), placeholder && /*#__PURE__*/React.createElement("option", {
    value: ""
  }, placeholder), options.map(o => {
    const opt = typeof o === "string" ? {
      value: o,
      label: o
    } : o;
    return /*#__PURE__*/React.createElement("option", {
      key: opt.value,
      value: opt.value
    }, opt.label);
  })), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down",
    size: 16,
    style: {
      position: "absolute",
      right: 10,
      color: "var(--text-secondary)",
      pointerEvents: "none"
    }
  }));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Switch({
  checked,
  defaultChecked,
  onChange,
  label,
  size = "md",
  disabled = false,
  style,
  ...rest
}) {
  const [internal, setInternal] = React.useState(!!defaultChecked);
  const on = checked === undefined ? internal : checked;
  const w = size === "sm" ? 32 : 40;
  const h = size === "sm" ? 18 : 22;
  const knob = h - 4;
  const toggle = () => {
    if (disabled) return;
    if (checked === undefined) setInternal(!on);
    onChange && onChange(!on);
  };
  return /*#__PURE__*/React.createElement("label", _extends({
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "var(--space-3)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    role: "switch",
    "aria-checked": on,
    tabIndex: disabled ? -1 : 0,
    onClick: toggle,
    onKeyDown: e => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        toggle();
      }
    },
    style: {
      width: w,
      height: h,
      flex: "0 0 auto",
      borderRadius: "var(--radius-pill)",
      background: on ? "var(--action-primary)" : "var(--kr-gray-border)",
      position: "relative",
      transition: "background-color var(--dur-base) var(--ease-standard)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 2,
      left: on ? w - knob - 2 : 2,
      width: knob,
      height: knob,
      borderRadius: "var(--radius-pill)",
      background: "var(--kr-paper)",
      boxShadow: "var(--shadow-xs)",
      transition: "left var(--dur-base) var(--ease-standard)"
    }
  })), label && /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-body-dense)",
      color: "var(--text-body)"
    }
  }, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Breadcrumbs.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Breadcrumbs({
  items = [],
  onChrome = false,
  onNavigate,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("nav", _extends({
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      ...style
    }
  }, rest), items.map((item, i) => {
    const last = i === items.length - 1;
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: item.label + i
    }, i > 0 && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "chevron-right",
      size: 12,
      style: {
        color: onChrome ? "var(--text-on-chrome-disabled)" : "var(--text-placeholder)"
      }
    }), /*#__PURE__*/React.createElement("button", {
      onClick: () => !last && onNavigate && onNavigate(item.id || item.label),
      style: {
        border: "none",
        background: "transparent",
        padding: 0,
        font: "var(--type-caption)",
        fontWeight: last ? "var(--weight-medium)" : "var(--weight-regular)",
        color: last ? onChrome ? "var(--text-on-chrome-secondary)" : "var(--text-secondary)" : onChrome ? "var(--text-on-chrome-secondary)" : "var(--text-link)",
        cursor: last ? "default" : "pointer"
      }
    }, item.label));
  }));
}
Object.assign(__ds_scope, { Breadcrumbs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Breadcrumbs.jsx", error: String((e && e.message) || e) }); }

// components/navigation/SidebarNav.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function SidebarNav({
  sections = [],
  active,
  onNavigate,
  collapsed = false,
  basePath = "assets",
  footer,
  style,
  ...rest
}) {
  const [hovered, setHovered] = React.useState(null);
  return /*#__PURE__*/React.createElement("nav", _extends({
    style: {
      width: collapsed ? "var(--sidebar-w-collapsed)" : "var(--sidebar-w)",
      flex: "0 0 auto",
      background: "var(--surface-chrome)",
      borderRight: "1px solid var(--border-chrome)",
      display: "flex",
      flexDirection: "column",
      transition: "width var(--dur-base) var(--ease-standard)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      height: "var(--topbar-h)",
      display: "flex",
      alignItems: "center",
      padding: collapsed ? 0 : "0 var(--space-4)",
      justifyContent: collapsed ? "center" : "flex-start",
      flex: "0 0 auto"
    }
  }, collapsed ? /*#__PURE__*/React.createElement(__ds_scope.Logo, {
    variant: "mark-solid",
    height: 28,
    basePath: basePath
  }) : /*#__PURE__*/React.createElement(__ds_scope.Logo, {
    variant: "horizontal-navy",
    height: 30,
    basePath: basePath
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: "auto",
      padding: "var(--space-2) var(--space-2) var(--space-6)"
    }
  }, sections.map((section, si) => /*#__PURE__*/React.createElement("div", {
    key: section.label || si,
    style: {
      marginTop: si ? "var(--space-6)" : "var(--space-2)"
    }
  }, section.label && !collapsed && /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-overline)",
      textTransform: "uppercase",
      letterSpacing: "var(--tracking-caps)",
      color: "var(--text-on-chrome-secondary)",
      padding: "0 var(--space-3) var(--space-2)"
    }
  }, section.label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 2
    }
  }, (section.items || []).map(item => {
    const on = item.id === active;
    const hot = hovered === item.id && !on;
    return /*#__PURE__*/React.createElement("button", {
      key: item.id,
      onClick: () => onNavigate && onNavigate(item.id),
      onMouseEnter: () => setHovered(item.id),
      onMouseLeave: () => setHovered(null),
      title: collapsed ? item.label : undefined,
      style: {
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        width: "100%",
        padding: collapsed ? "10px 0" : "9px var(--space-3)",
        justifyContent: collapsed ? "center" : "flex-start",
        border: "none",
        borderRadius: "var(--radius-control)",
        background: on ? "var(--surface-chrome-elevated)" : hot ? "var(--action-ghost-hover-bg-chrome)" : "transparent",
        color: on ? "var(--text-on-chrome)" : "var(--text-on-chrome-secondary)",
        font: "var(--type-label)",
        fontWeight: on ? "var(--weight-semibold)" : "var(--weight-medium)",
        cursor: "pointer",
        position: "relative",
        textAlign: "left",
        transition: "var(--transition-control)"
      }
    }, on && /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        left: 0,
        top: 8,
        bottom: 8,
        width: 3,
        borderRadius: "0 2px 2px 0",
        background: "var(--action-primary)"
      }
    }), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: item.icon,
      size: 18,
      style: {
        color: on ? "var(--action-primary)" : "currentColor"
      }
    }), !collapsed && /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1
      }
    }, item.label), !collapsed && item.badge !== undefined && /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--type-caption)",
        fontWeight: "var(--weight-semibold)",
        background: "var(--action-primary)",
        color: "var(--text-on-brand)",
        borderRadius: "var(--radius-pill)",
        padding: "1px 6px"
      }
    }, item.badge));
  }))))), footer && /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "0 0 auto",
      borderTop: "1px solid var(--border-chrome)",
      padding: "var(--space-3)"
    }
  }, footer));
}
Object.assign(__ds_scope, { SidebarNav });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/SidebarNav.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Tabs({
  tabs = [],
  value,
  defaultValue,
  onChange,
  variant = "underline",
  onChrome = false,
  style,
  ...rest
}) {
  const first = tabs.length ? typeof tabs[0] === "string" ? tabs[0] : tabs[0].value : undefined;
  const [internal, setInternal] = React.useState(defaultValue ?? first);
  const current = value === undefined ? internal : value;
  const pick = v => {
    if (value === undefined) setInternal(v);
    onChange && onChange(v);
  };
  const pill = variant === "pill";
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "tablist",
    style: {
      display: "flex",
      alignItems: "center",
      gap: pill ? 4 : "var(--space-6)",
      padding: pill ? 4 : 0,
      background: pill ? "var(--surface-subtle)" : "transparent",
      borderRadius: pill ? "var(--radius-control)" : 0,
      borderBottom: pill ? "none" : "1px solid " + (onChrome ? "var(--border-chrome)" : "var(--border-default)"),
      ...style
    }
  }, rest), tabs.map(t => {
    const tab = typeof t === "string" ? {
      value: t,
      label: t
    } : t;
    const on = current === tab.value;
    return /*#__PURE__*/React.createElement("button", {
      key: tab.value,
      role: "tab",
      "aria-selected": on,
      onClick: () => pick(tab.value),
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: "none",
        background: pill && on ? "var(--surface-card)" : "transparent",
        boxShadow: pill && on ? "var(--shadow-xs)" : "none",
        borderRadius: pill ? "var(--radius-sm)" : 0,
        padding: pill ? "6px 12px" : "0 0 10px",
        marginBottom: pill ? 0 : -1,
        borderBottom: pill ? "none" : "2px solid " + (on ? "var(--action-primary)" : "transparent"),
        font: "var(--type-label)",
        fontWeight: on ? "var(--weight-semibold)" : "var(--weight-medium)",
        color: on ? onChrome ? "var(--text-on-chrome)" : "var(--text-body)" : onChrome ? "var(--text-on-chrome-secondary)" : "var(--text-secondary)",
        cursor: "pointer",
        transition: "var(--transition-control)"
      }
    }, tab.icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: tab.icon,
      size: 15
    }), tab.label, tab.count !== undefined && /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--type-caption)",
        fontWeight: "var(--weight-semibold)",
        color: on ? "var(--text-accent)" : "var(--text-secondary)",
        background: on ? "var(--surface-accent)" : "var(--surface-subtle)",
        borderRadius: "var(--radius-pill)",
        padding: "1px 6px"
      }
    }, tab.count));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Topbar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Topbar({
  title,
  breadcrumbs,
  tenant,
  user,
  actions,
  onSearch,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("header", _extends({
    style: {
      height: "var(--topbar-h)",
      flex: "0 0 auto",
      display: "flex",
      alignItems: "center",
      gap: "var(--space-4)",
      padding: "0 var(--space-6)",
      background: "var(--surface-chrome)",
      borderBottom: "1px solid var(--border-chrome)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, breadcrumbs && /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 1
    }
  }, breadcrumbs), title && /*#__PURE__*/React.createElement("h1", {
    style: {
      font: "var(--type-section-title)",
      color: "var(--text-on-chrome)",
      letterSpacing: "var(--tracking-tight)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, title)), onSearch && /*#__PURE__*/React.createElement("label", {
    style: {
      marginLeft: "auto",
      display: "flex",
      alignItems: "center",
      gap: "var(--space-2)",
      width: 300,
      height: 36,
      padding: "0 12px",
      background: "var(--surface-chrome-elevated)",
      border: "1px solid var(--border-chrome)",
      borderRadius: "var(--radius-control)"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "search",
    size: 16,
    style: {
      color: "var(--text-on-chrome-secondary)"
    }
  }), /*#__PURE__*/React.createElement("input", {
    placeholder: "Search trips, plates, invoices",
    onChange: e => onSearch(e.target.value),
    style: {
      flex: 1,
      minWidth: 0,
      background: "transparent",
      border: "none",
      outline: "none",
      font: "var(--type-body-dense)",
      color: "var(--text-on-chrome)"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: onSearch ? 0 : "auto",
      display: "flex",
      alignItems: "center",
      gap: "var(--space-2)"
    }
  }, tenant && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "5px 10px",
      borderRadius: "var(--radius-control)",
      border: "1px solid var(--border-chrome)",
      background: "var(--surface-chrome-elevated)",
      font: "var(--type-label)",
      color: "var(--text-on-chrome)"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "building-2",
    size: 14,
    style: {
      color: "var(--action-primary)"
    }
  }), tenant, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down",
    size: 14,
    style: {
      color: "var(--text-on-chrome-secondary)"
    }
  })), actions, /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    icon: "bell",
    label: "Notifications",
    onChrome: true
  }), user && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-2)",
      paddingLeft: "var(--space-2)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 32,
      height: 32,
      borderRadius: "var(--radius-pill)",
      background: "var(--action-primary)",
      color: "var(--text-on-brand)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      font: "var(--type-label)",
      fontWeight: "var(--weight-semibold)"
    }
  }, user.initials || (user.name || "?").slice(0, 2).toUpperCase()), /*#__PURE__*/React.createElement("span", {
    style: {
      lineHeight: 1.2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      font: "var(--type-label)",
      color: "var(--text-on-chrome)"
    }
  }, user.name), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      font: "var(--type-caption)",
      color: "var(--text-on-chrome-secondary)"
    }
  }, user.role)))));
}
Object.assign(__ds_scope, { Topbar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Topbar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/driver-web/DriverFlow.jsx
try { (() => {
Object.assign(window, window.KangaruRideDesignSystem_69b541);
function PhoneChrome({
  children,
  title,
  right
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: 390,
      minHeight: 780,
      background: "var(--surface-page)",
      border: "1px solid var(--border-default)",
      borderRadius: "var(--radius-2xl)",
      overflow: "hidden",
      boxShadow: "var(--shadow-lg)",
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--surface-chrome)",
      padding: "var(--space-3) var(--space-4)",
      display: "flex",
      alignItems: "center",
      gap: "var(--space-3)"
    }
  }, /*#__PURE__*/React.createElement(Logo, {
    variant: "mark-solid",
    height: 26,
    basePath: "../../assets"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      font: "var(--type-label)",
      fontWeight: 600,
      color: "var(--text-on-chrome)"
    }
  }, title), right), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      padding: "var(--space-4)",
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-4)"
    }
  }, children));
}
function DriverRow({
  label,
  value,
  mono
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      gap: "var(--space-4)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-secondary)"
    }
  }, label), mono ? /*#__PURE__*/React.createElement(Identifier, null, value) : /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-label)",
      textAlign: "right"
    }
  }, value));
}
function DriverFlow() {
  const [stage, setStage] = React.useState("assigned");
  const [odo, setOdo] = React.useState("");
  const [online, setOnline] = React.useState(true);
  const header = /*#__PURE__*/React.createElement(IconButton, {
    icon: online ? "wifi" : "wifi-off",
    label: online ? "Online" : "Offline — trips queue locally",
    onChrome: true,
    onClick: () => setOnline(!online)
  });
  return /*#__PURE__*/React.createElement(PhoneChrome, {
    title: "Driver \xB7 Moses Okello",
    right: header
  }, !online && /*#__PURE__*/React.createElement(Alert, {
    tone: "info",
    title: "Offline"
  }, "Captures are stored on this device and sync when you reconnect."), stage === "assigned" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    title: "Next trip",
    subtitle: "Assigned 07:58",
    actions: /*#__PURE__*/React.createElement(StatusBadge, {
      state: "assigned",
      size: "sm"
    })
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-3)"
    }
  }, /*#__PURE__*/React.createElement(DriverRow, {
    label: "Pickup",
    value: "Mapeera House, Kampala Rd"
  }), /*#__PURE__*/React.createElement(DriverRow, {
    label: "Destination",
    value: "Entebbe Int. Airport"
  }), /*#__PURE__*/React.createElement(DriverRow, {
    label: "Passenger",
    value: "J. Mubiru \xB7 Treasury"
  }), /*#__PURE__*/React.createElement(DriverRow, {
    label: "Vehicle",
    value: "UBK 421J",
    mono: true
  }), /*#__PURE__*/React.createElement(DriverRow, {
    label: "Trip",
    value: "TRP-2026-04812",
    mono: true
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-2)",
      marginTop: "auto"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    fullWidth: true,
    iconLeft: "check",
    onClick: () => setStage("enroute")
  }, "Accept trip"), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    fullWidth: true,
    variant: "secondary"
  }, "Reject \u2014 recorded against me"))), stage === "enroute" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    title: "En route to pickup",
    actions: /*#__PURE__*/React.createElement(StatusBadge, {
      state: "driver_en_route",
      size: "sm"
    })
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-3)"
    }
  }, /*#__PURE__*/React.createElement(DriverRow, {
    label: "Pickup",
    value: "Mapeera House, Kampala Rd"
  }), /*#__PURE__*/React.createElement(DriverRow, {
    label: "Distance",
    value: "1.2 km",
    mono: true
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true,
    iconLeft: "navigation"
  }, "Open navigation"))), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    fullWidth: true,
    onClick: () => setStage("arrived"),
    style: {
      marginTop: "auto"
    }
  }, "I have arrived")), stage === "arrived" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    title: "At pickup",
    actions: /*#__PURE__*/React.createElement(StatusBadge, {
      state: "driver_arrived",
      size: "sm"
    })
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-body-dense)",
      color: "var(--text-secondary)"
    }
  }, "Waiting time starts counting after 5 minutes and is billed per the rate card. Mark a no-show only after the configured wait.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-2)",
      marginTop: "auto"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    fullWidth: true,
    onClick: () => setStage("start")
  }, "Passenger onboard"), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    fullWidth: true,
    variant: "destructive",
    iconLeft: "user-round-x"
  }, "Report no show"))), stage === "start" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    title: "Start trip",
    subtitle: "Opening odometer is required"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-4)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 150,
      borderRadius: "var(--radius-md)",
      background: "var(--kr-gray-100)",
      border: "1px dashed var(--border-strong)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      color: "var(--text-secondary)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "camera",
    size: 22
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)"
    }
  }, "Photograph the dashboard"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary"
  }, "Take photo")), /*#__PURE__*/React.createElement(FormField, {
    label: "Opening odometer",
    required: true,
    hint: "Enter the reading exactly as shown"
  }, /*#__PURE__*/React.createElement(Input, {
    mono: true,
    size: "lg",
    suffix: "km",
    placeholder: "000000",
    value: odo,
    onChange: e => setOdo(e.target.value)
  })))), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    fullWidth: true,
    iconLeft: "play",
    onClick: () => setStage("running"),
    style: {
      marginTop: "auto"
    }
  }, "Start trip")), stage === "running" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    title: "Trip in progress",
    actions: /*#__PURE__*/React.createElement(StatusBadge, {
      state: "trip_started",
      size: "sm"
    })
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-3)"
    }
  }, /*#__PURE__*/React.createElement(DriverRow, {
    label: "Started",
    value: "08:14:22",
    mono: true
  }), /*#__PURE__*/React.createElement(DriverRow, {
    label: "Opening odometer",
    value: (odo || "128,940") + " km",
    mono: true
  }), /*#__PURE__*/React.createElement(DriverRow, {
    label: "GPS distance so far",
    value: "22.8 km",
    mono: true
  }), /*#__PURE__*/React.createElement(DriverRow, {
    label: "Waiting time",
    value: "12 min",
    mono: true
  }))), /*#__PURE__*/React.createElement(Card, {
    title: "Stops"
  }, /*#__PURE__*/React.createElement(TripTimeline, {
    events: [{
      label: "Trip started",
      time: "08:14:22"
    }, {
      label: "Waiting",
      time: "08:51:03",
      tone: "warning",
      icon: "pause",
      detail: "Resumed 09:03:11"
    }]
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-2)",
      marginTop: "auto"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    fullWidth: true,
    variant: "secondary",
    iconLeft: "pause"
  }, "Start waiting"), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    fullWidth: true,
    iconLeft: "flag",
    onClick: () => setStage("complete")
  }, "Complete trip"))), stage === "complete" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    title: "Complete trip",
    subtitle: "Closing odometer is required"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-4)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 150,
      borderRadius: "var(--radius-md)",
      background: "var(--kr-gray-100)",
      border: "1px dashed var(--border-strong)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      color: "var(--text-secondary)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "camera",
    size: 22
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)"
    }
  }, "Photograph the dashboard"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "secondary"
  }, "Take photo")), /*#__PURE__*/React.createElement(FormField, {
    label: "Closing odometer",
    required: true
  }, /*#__PURE__*/React.createElement(Input, {
    mono: true,
    size: "lg",
    suffix: "km",
    defaultValue: "128982"
  })), /*#__PURE__*/React.createElement(Alert, {
    tone: "warning",
    title: "Check this reading"
  }, "Odometer distance 42 km differs from GPS distance 38.4 km. A variance is flagged for review."))), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    fullWidth: true,
    iconLeft: "check",
    onClick: () => setStage("done"),
    style: {
      marginTop: "auto"
    }
  }, "Submit and complete")), stage === "done" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Card, {
    padding: "none"
  }, /*#__PURE__*/React.createElement(EmptyState, {
    icon: "circle-check",
    title: "Trip completed",
    description: "TRP-2026-04812 submitted. The record is queued for invoicing and the variance is flagged for the operations team."
  })), /*#__PURE__*/React.createElement(Card, {
    title: "Today"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-3)"
    }
  }, /*#__PURE__*/React.createElement(DriverRow, {
    label: "Trips completed",
    value: "4",
    mono: true
  }), /*#__PURE__*/React.createElement(DriverRow, {
    label: "Distance",
    value: "182.6 km",
    mono: true
  }), /*#__PURE__*/React.createElement(DriverRow, {
    label: "Waiting time billed",
    value: "38 min",
    mono: true
  }))), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    fullWidth: true,
    variant: "secondary",
    onClick: () => setStage("assigned"),
    style: {
      marginTop: "auto"
    }
  }, "Next trip")));
}
Object.assign(window, {
  DriverFlow,
  PhoneChrome
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/driver-web/DriverFlow.jsx", error: String((e && e.message) || e) }); }

// ui_kits/platform/BillingScreen.jsx
try { (() => {
Object.assign(window, window.KangaruRideDesignSystem_69b541);
const INVOICES = [{
  id: 1,
  no: "INV-2026-0417",
  company: "Centenary Bank",
  period: "Jun 2026",
  trips: 3128,
  amount: "41,208,500",
  due: "2026-08-01",
  state: "invoice_generated"
}, {
  id: 2,
  no: "INV-2026-0416",
  company: "Centenary Bank",
  period: "May 2026",
  trips: 2984,
  amount: "38,914,000",
  due: "2026-07-01",
  state: "paid"
}, {
  id: 3,
  no: "INV-2026-0415",
  company: "Uganda Red Cross",
  period: "Jun 2026",
  trips: 412,
  amount: "6,105,000",
  due: "2026-07-15",
  state: "overdue"
}, {
  id: 4,
  no: "INV-2026-0414",
  company: "Ministry of Works",
  period: "Jun 2026",
  trips: 288,
  amount: "4,882,400",
  due: "2026-08-01",
  state: "disputed"
}, {
  id: 5,
  no: "INV-2026-0413",
  company: "Aga Khan Foundation",
  period: "Jun 2026",
  trips: 96,
  amount: "1,740,000",
  due: "2026-07-20",
  state: "paid"
}];
function BillingScreen() {
  const [creditNote, setCreditNote] = React.useState(false);
  const cols = [{
    key: "no",
    header: "Invoice no.",
    render: r => /*#__PURE__*/React.createElement(Identifier, {
      kind: "chip"
    }, r.no)
  }, {
    key: "company",
    header: "Company",
    sortable: true
  }, {
    key: "period",
    header: "Period"
  }, {
    key: "trips",
    header: "Trips",
    numeric: true,
    sortable: true
  }, {
    key: "amount",
    header: "Amount (UGX)",
    numeric: true,
    sortable: true
  }, {
    key: "due",
    header: "Due",
    numeric: true,
    render: r => /*#__PURE__*/React.createElement(Identifier, {
      size: "xs",
      tone: "muted"
    }, r.due)
  }, {
    key: "state",
    header: "Status",
    render: r => /*#__PURE__*/React.createElement(StatusBadge, {
      state: r.state,
      size: "sm"
    })
  }, {
    key: "act",
    header: "",
    width: 88,
    render: r => /*#__PURE__*/React.createElement("span", {
      style: {
        display: "flex",
        gap: 4,
        justifyContent: "flex-end"
      }
    }, /*#__PURE__*/React.createElement(IconButton, {
      icon: "download",
      label: "Download PDF",
      size: "sm"
    }), /*#__PURE__*/React.createElement(IconButton, {
      icon: "ellipsis-vertical",
      label: "More",
      size: "sm",
      onClick: () => setCreditNote(true)
    }))
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHead, {
    title: "Invoices",
    sub: "Monthly billing \xB7 amounts stored as integer UGX \xB7 every invoice reproducible from stored inputs",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      iconLeft: "table-2"
    }, "Rate cards"), /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      iconLeft: "download"
    }, "Export Excel"), /*#__PURE__*/React.createElement(Button, {
      iconLeft: "file-plus"
    }, "Generate invoices"))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4,1fr)",
      gap: "var(--space-4)",
      marginBottom: "var(--space-6)"
    }
  }, /*#__PURE__*/React.createElement(KPIStat, {
    label: "Invoiced this month",
    value: "52.9M",
    unit: "UGX",
    icon: "receipt"
  }), /*#__PURE__*/React.createElement(KPIStat, {
    label: "Outstanding",
    value: "10.9M",
    unit: "UGX",
    delta: "-6%",
    deltaDirection: "down",
    icon: "clock"
  }), /*#__PURE__*/React.createElement(KPIStat, {
    label: "Disputed",
    value: "1",
    hint: "0.8% of invoices",
    icon: "triangle-alert"
  }), /*#__PURE__*/React.createElement(KPIStat, {
    tone: "accent",
    label: "Days to month close",
    value: "10",
    icon: "calendar-clock"
  })), /*#__PURE__*/React.createElement(Alert, {
    tone: "info",
    title: "Rate card v4 is in use and locked",
    style: {
      marginBottom: "var(--space-4)"
    }
  }, "Rate cards are versioned and immutable once used. Historical invoices always reference their exact version."), /*#__PURE__*/React.createElement(FilterBar, null, /*#__PURE__*/React.createElement(Input, {
    size: "sm",
    iconLeft: "search",
    placeholder: "Invoice no. or company",
    style: {
      width: 260
    }
  }), /*#__PURE__*/React.createElement(Select, {
    size: "sm",
    placeholder: "All companies",
    options: ["Centenary Bank", "Uganda Red Cross", "Ministry of Works"]
  }), /*#__PURE__*/React.createElement(Select, {
    size: "sm",
    placeholder: "All statuses",
    options: ["Generated", "Paid", "Overdue", "Disputed"]
  }), /*#__PURE__*/React.createElement(Select, {
    size: "sm",
    defaultValue: "jun",
    options: [{
      value: "jun",
      label: "June 2026"
    }, {
      value: "may",
      label: "May 2026"
    }]
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    iconLeft: "x"
  }, "Clear")), /*#__PURE__*/React.createElement(Card, {
    padding: "none"
  }, /*#__PURE__*/React.createElement(DataTable, {
    dense: true,
    selectable: true,
    columns: cols,
    rows: INVOICES
  }), /*#__PURE__*/React.createElement(Pagination, {
    page: 1,
    pageCount: 3,
    pageSize: 25,
    total: 64
  })), /*#__PURE__*/React.createElement(Dialog, {
    open: creditNote,
    tone: "warning",
    title: "Issue a credit note",
    description: "Issued invoices are never edited. A credit note is appended and the original invoice remains on record.",
    onClose: () => setCreditNote(false),
    width: 560,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      onClick: () => setCreditNote(false)
    }, "Cancel"), /*#__PURE__*/React.createElement(Button, {
      onClick: () => setCreditNote(false)
    }, "Issue credit note"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-4)"
    }
  }, /*#__PURE__*/React.createElement(FormField, {
    label: "Amount",
    required: true,
    hint: "Integer UGX"
  }, /*#__PURE__*/React.createElement(Input, {
    mono: true,
    suffix: "UGX",
    placeholder: "0"
  })), /*#__PURE__*/React.createElement(FormField, {
    label: "Reason",
    required: true
  }, /*#__PURE__*/React.createElement(Select, {
    placeholder: "Select a reason",
    options: ["Disputed distance", "Duplicate trip billed", "Rate applied in error", "Goodwill adjustment"]
  })))));
}
Object.assign(window, {
  BillingScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/platform/BillingScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/platform/DashboardScreen.jsx
try { (() => {
Object.assign(window, window.KangaruRideDesignSystem_69b541);
const LIVE_ROWS = [{
  id: 1,
  trip: "TRP-2026-04812",
  plate: "UBK 421J",
  driver: "Moses Okello",
  route: "Mapeera House → Entebbe Airport",
  dist: "38.4",
  dur: "1h 18m",
  state: "trip_started"
}, {
  id: 2,
  trip: "TRP-2026-04811",
  plate: "UAX 908K",
  driver: "Sarah Achieng",
  route: "Nakawa Branch → Ntinda",
  dist: "12.1",
  dur: "0h 34m",
  state: "waiting"
}, {
  id: 3,
  trip: "TRP-2026-04810",
  plate: "UBG 117D",
  driver: "Peter Kagoro",
  route: "Head Office → Mbarara Branch",
  dist: "268.9",
  dur: "5h 02m",
  state: "driver_en_route"
}, {
  id: 4,
  trip: "TRP-2026-04808",
  plate: "UAP 553M",
  driver: "Grace Namuli",
  route: "Kololo → Head Office",
  dist: "6.2",
  dur: "0h 19m",
  state: "passenger_onboard"
}, {
  id: 5,
  trip: "TRP-2026-04807",
  plate: "UBJ 210Q",
  driver: "Ismail Wasswa",
  route: "Head Office → Jinja Branch",
  dist: "82.5",
  dur: "1h 51m",
  state: "trip_completed"
}];
const LIVE_COLS = [{
  key: "trip",
  header: "Trip ID",
  render: r => /*#__PURE__*/React.createElement(Identifier, {
    kind: "chip"
  }, r.trip)
}, {
  key: "plate",
  header: "Vehicle",
  render: r => /*#__PURE__*/React.createElement(Identifier, {
    kind: "plate"
  }, r.plate)
}, {
  key: "driver",
  header: "Driver",
  sortable: true
}, {
  key: "route",
  header: "Route",
  wrap: false
}, {
  key: "dist",
  header: "Distance (km)",
  numeric: true,
  sortable: true
}, {
  key: "dur",
  header: "Duration",
  numeric: true
}, {
  key: "state",
  header: "Status",
  render: r => /*#__PURE__*/React.createElement(StatusBadge, {
    state: r.state,
    size: "sm"
  })
}];
function DashboardScreen({
  onOpenTrip
}) {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHead, {
    title: "Operations dashboard",
    sub: "Tuesday 21 July 2026 \xB7 Centenary Bank \xB7 all branches",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      iconLeft: "download"
    }, "Export day report"), /*#__PURE__*/React.createElement(Button, {
      iconLeft: "plus"
    }, "New booking"))
  }), /*#__PURE__*/React.createElement(Alert, {
    tone: "warning",
    title: "3 trips have an odometer / GPS variance above threshold",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      size: "sm"
    }, "Review flags"),
    style: {
      marginBottom: "var(--space-6)"
    }
  }, "Variance flags must be reviewed within 2 business days before invoicing."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: "var(--space-4)",
      marginBottom: "var(--space-6)"
    }
  }, /*#__PURE__*/React.createElement(KPIStat, {
    label: "Trips today",
    value: "184",
    delta: "+12%",
    hint: "vs last Tuesday",
    icon: "route"
  }), /*#__PURE__*/React.createElement(KPIStat, {
    label: "Vehicles active",
    value: "41",
    unit: "/ 68",
    icon: "truck",
    hint: "27 idle at depots"
  }), /*#__PURE__*/React.createElement(KPIStat, {
    label: "Distance today",
    value: "4,182",
    unit: "km",
    delta: "+4%",
    icon: "gauge"
  }), /*#__PURE__*/React.createElement(KPIStat, {
    tone: "accent",
    label: "Billed this month",
    value: "41.2M",
    unit: "UGX",
    icon: "receipt",
    hint: "Invoices due 1 Aug"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.6fr 1fr",
      gap: "var(--space-4)",
      marginBottom: "var(--space-6)"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    title: "Live fleet",
    subtitle: "Position freshness under 15 seconds",
    padding: "none",
    actions: /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      size: "sm",
      iconLeft: "maximize-2"
    }, "Full map")
  }, /*#__PURE__*/React.createElement(MapSurface, {
    height: 300
  }, /*#__PURE__*/React.createElement(VehiclePin, {
    top: 60,
    left: 90,
    plate: "UBK 421J"
  }), /*#__PURE__*/React.createElement(VehiclePin, {
    top: 150,
    left: 260,
    plate: "UAX 908K",
    state: "waiting"
  }), /*#__PURE__*/React.createElement(VehiclePin, {
    top: 220,
    left: 120,
    plate: "UBG 117D",
    state: "driver_en_route"
  }))), /*#__PURE__*/React.createElement(Card, {
    title: "Dispatch queue",
    subtitle: "6 bookings awaiting assignment",
    actions: /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      size: "sm"
    }, "Open board")
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-3)"
    }
  }, [{
    t: "08:40",
    from: "Head Office",
    to: "Kampala Serena",
    cat: "Saloon",
    urgent: true
  }, {
    t: "09:15",
    from: "Nakawa Branch",
    to: "Ntinda",
    cat: "SUV"
  }, {
    t: "09:30",
    from: "Head Office",
    to: "Entebbe Airport",
    cat: "Van"
  }, {
    t: "10:00",
    from: "Kololo",
    to: "Head Office",
    cat: "Saloon"
  }].map((b, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-3)",
      padding: "var(--space-3)",
      border: "1px solid var(--border-default)",
      borderRadius: "var(--radius-md)",
      background: b.urgent ? "var(--surface-accent)" : "var(--surface-card)"
    }
  }, /*#__PURE__*/React.createElement(Identifier, {
    size: "xs"
  }, b.t), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      font: "var(--type-label)",
      color: "var(--text-body)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, b.from, " \u2192 ", b.to), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-secondary)"
    }
  }, b.cat)), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: b.urgent ? "primary" : "secondary"
  }, "Assign")))))), /*#__PURE__*/React.createElement(Card, {
    title: "Live and recent trips",
    padding: "none",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Select, {
      size: "sm",
      defaultValue: "all",
      options: [{
        value: "all",
        label: "All branches"
      }, {
        value: "hq",
        label: "Head Office"
      }]
    }), /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      size: "sm",
      iconLeft: "filter"
    }, "Filters"))
  }, /*#__PURE__*/React.createElement(DataTable, {
    dense: true,
    columns: LIVE_COLS,
    rows: LIVE_ROWS,
    onRowClick: onOpenTrip
  }), /*#__PURE__*/React.createElement(Pagination, {
    page: 1,
    pageCount: 8,
    pageSize: 25,
    total: 184
  })));
}
Object.assign(window, {
  DashboardScreen,
  LIVE_ROWS,
  LIVE_COLS
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/platform/DashboardScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/platform/DispatchScreen.jsx
try { (() => {
Object.assign(window, window.KangaruRideDesignSystem_69b541);
const QUEUE = [{
  id: "BKG-2026-11204",
  time: "08:40",
  from: "Head Office, Mapeera House",
  to: "Kampala Serena Hotel",
  cat: "Saloon",
  passenger: "J. Mubiru · Treasury",
  zone: "Town",
  urgent: true
}, {
  id: "BKG-2026-11205",
  time: "09:15",
  from: "Nakawa Branch",
  to: "Ntinda Complex",
  cat: "SUV",
  passenger: "A. Kirabo · Audit",
  zone: "Town"
}, {
  id: "BKG-2026-11206",
  time: "09:30",
  from: "Head Office",
  to: "Entebbe Airport",
  cat: "Van",
  passenger: "Delegation (4)",
  zone: "Town"
}, {
  id: "BKG-2026-11207",
  time: "10:00",
  from: "Kololo Residence",
  to: "Head Office",
  cat: "Saloon",
  passenger: "R. Ssentongo · Exec",
  zone: "Town"
}, {
  id: "BKG-2026-11208",
  time: "11:00",
  from: "Head Office",
  to: "Mbarara Branch",
  cat: "SUV",
  passenger: "Inspection team (2)",
  zone: "Upcountry"
}, {
  id: "BKG-2026-11209",
  time: "13:30",
  from: "Jinja Branch",
  to: "Head Office",
  cat: "Saloon",
  passenger: "P. Nangobi · Ops",
  zone: "Upcountry"
}];
const CANDIDATES = [{
  name: "Moses Okello",
  plate: "UBK 421J",
  cat: "Saloon",
  depot: "Head Office",
  km: 1.2,
  status: "Available",
  pref: true
}, {
  name: "Grace Namuli",
  plate: "UAP 553M",
  cat: "Saloon",
  depot: "Head Office",
  km: 3.8,
  status: "Available"
}, {
  name: "Sarah Achieng",
  plate: "UAX 908K",
  cat: "SUV",
  depot: "Nakawa",
  km: 6.4,
  status: "On trip · ends 08:55"
}, {
  name: "Ismail Wasswa",
  plate: "UBJ 210Q",
  cat: "Van",
  depot: "Head Office",
  km: 2.1,
  status: "Available"
}];
function DispatchScreen() {
  const [selected, setSelected] = React.useState(QUEUE[0]);
  const [assigning, setAssigning] = React.useState(false);
  const [assigned, setAssigned] = React.useState([]);
  const [pick, setPick] = React.useState(CANDIDATES[0].plate);
  const queue = QUEUE.filter(q => !assigned.includes(q.id));
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(PageHead, {
    title: "Dispatch board",
    sub: "Manual and hybrid dispatch \xB7 assignment locks the driver and vehicle pessimistically",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      iconLeft: "settings-2"
    }, "Dispatch rules"), /*#__PURE__*/React.createElement(Button, {
      iconLeft: "plus"
    }, "New booking"))
  }), /*#__PURE__*/React.createElement(Tabs, {
    tabs: [{
      value: "unassigned",
      label: "Unassigned",
      icon: "user-x",
      count: queue.length
    }, {
      value: "assigned",
      label: "Assigned today",
      icon: "user-check",
      count: 178
    }, {
      value: "scheduled",
      label: "Scheduled",
      icon: "calendar-clock",
      count: 42
    }],
    style: {
      marginBottom: "var(--space-4)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "var(--space-4)"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    title: "Booking queue",
    padding: "none",
    subtitle: "Oldest first"
  }, queue.length === 0 ? /*#__PURE__*/React.createElement(EmptyState, {
    compact: true,
    icon: "route",
    title: "Queue clear",
    description: "Every booking for today has a driver and vehicle."
  }) : /*#__PURE__*/React.createElement("div", null, queue.map(b => {
    const on = selected && selected.id === b.id;
    return /*#__PURE__*/React.createElement("button", {
      key: b.id,
      onClick: () => setSelected(b),
      style: {
        display: "flex",
        width: "100%",
        textAlign: "left",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-3) var(--space-4)",
        background: on ? "var(--surface-accent)" : "transparent",
        border: "none",
        borderLeft: "3px solid " + (on ? "var(--action-primary)" : "transparent"),
        borderBottom: "1px solid var(--border-default)",
        cursor: "pointer"
      }
    }, /*#__PURE__*/React.createElement(Identifier, {
      size: "xs"
    }, b.time), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: "block",
        font: "var(--type-label)",
        color: "var(--text-body)"
      }
    }, b.from, " \u2192 ", b.to), /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--type-caption)",
        color: "var(--text-secondary)"
      }
    }, b.passenger)), /*#__PURE__*/React.createElement(Badge, {
      tone: b.zone === "Upcountry" ? "info" : "neutral",
      size: "sm"
    }, b.zone), /*#__PURE__*/React.createElement(Badge, {
      tone: "neutral",
      size: "sm",
      outline: true
    }, b.cat));
  }))), selected && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-4)"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    title: selected.from + " → " + selected.to,
    subtitle: selected.passenger,
    actions: /*#__PURE__*/React.createElement(Identifier, {
      kind: "chip"
    }, selected.id)
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: "var(--space-4)",
      marginBottom: "var(--space-4)"
    }
  }, [["Pickup", selected.time + " today"], ["Vehicle category", selected.cat], ["Pricing zone", selected.zone]].map(([k, v]) => /*#__PURE__*/React.createElement("div", {
    key: k
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      font: "var(--type-caption)",
      color: "var(--text-secondary)"
    }
  }, k), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-label)",
      color: "var(--text-body)"
    }
  }, v)))), /*#__PURE__*/React.createElement(MapSurface, {
    height: 150,
    label: "Route preview \xB7 Mapbox Directions"
  })), /*#__PURE__*/React.createElement(Card, {
    title: "Eligible drivers and vehicles",
    subtitle: "Filtered by category, geofence, depot and availability",
    padding: "none"
  }, /*#__PURE__*/React.createElement("div", null, CANDIDATES.map(c => /*#__PURE__*/React.createElement("label", {
    key: c.plate,
    onClick: () => setPick(c.plate),
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-3)",
      padding: "var(--space-3) var(--space-4)",
      borderBottom: "1px solid var(--border-default)",
      cursor: "pointer",
      background: pick === c.plate ? "var(--surface-accent)" : "transparent"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 16,
      height: 16,
      borderRadius: "var(--radius-pill)",
      border: "1px solid " + (pick === c.plate ? "var(--action-primary)" : "var(--border-input)"),
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, pick === c.plate && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      background: "var(--action-primary)",
      borderRadius: "var(--radius-pill)"
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      font: "var(--type-label)",
      color: "var(--text-body)"
    }
  }, c.name, c.pref && /*#__PURE__*/React.createElement(Badge, {
    tone: "brand",
    size: "sm",
    icon: "star"
  }, "Preferred")), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-secondary)"
    }
  }, c.depot, " depot \xB7 ", c.km, " km away \xB7 ", c.status)), /*#__PURE__*/React.createElement(Identifier, {
    kind: "plate",
    size: "xs"
  }, c.plate)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "flex-end",
      gap: "var(--gap-inline)",
      padding: "var(--space-3) var(--space-4)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary"
  }, "Skip"), /*#__PURE__*/React.createElement(Button, {
    iconLeft: "user-check",
    onClick: () => setAssigning(true)
  }, "Assign"))))), /*#__PURE__*/React.createElement(Dialog, {
    open: assigning,
    title: "Confirm assignment",
    description: "This locks " + pick + " and its driver to " + (selected ? selected.id : "") + ". The driver is notified by SMS and the action is written to the audit log.",
    onClose: () => setAssigning(false),
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      onClick: () => setAssigning(false)
    }, "Back"), /*#__PURE__*/React.createElement(Button, {
      iconLeft: "check",
      onClick: () => {
        setAssigned(a => [...a, selected.id]);
        setAssigning(false);
        const next = QUEUE.find(q => q.id !== selected.id && ![...assigned, selected.id].includes(q.id));
        setSelected(next || null);
      }
    }, "Confirm assignment"))
  }, /*#__PURE__*/React.createElement(FormField, {
    label: "Dispatch note (optional)",
    hint: "Visible to the driver and stored on the trip record"
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "e.g. Collect from the west gate"
  }))));
}
Object.assign(window, {
  DispatchScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/platform/DispatchScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/platform/LoginScreen.jsx
try { (() => {
Object.assign(window, window.KangaruRideDesignSystem_69b541);
function LoginScreen({
  onSignIn
}) {
  const [mfa, setMfa] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: "100vh",
      display: "grid",
      gridTemplateColumns: "1.1fr 1fr"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--surface-chrome)",
      padding: "var(--space-16) var(--space-12)",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement(Logo, {
    variant: "horizontal-navy",
    height: 38,
    basePath: "../../assets"
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      font: "var(--type-page-title)",
      fontSize: "var(--text-4xl)",
      color: "var(--text-on-chrome)",
      maxWidth: 460
    }
  }, "Every trip recorded. Every invoice reproducible."), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-body)",
      color: "var(--text-on-chrome-secondary)",
      marginTop: "var(--space-4)",
      maxWidth: 460
    }
  }, "Transport management for corporate fleets: dispatch, GPS tracking, odometer capture, rate-card billing and enterprise reporting."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--space-2)",
      marginTop: "var(--space-6)",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "brand",
    icon: "shield-check"
  }, "Tenant-scoped"), /*#__PURE__*/React.createElement(Badge, {
    tone: "brand",
    icon: "file-text"
  }, "Audit logged"), /*#__PURE__*/React.createElement(Badge, {
    tone: "brand",
    icon: "wifi-off"
  }, "Offline tolerant"))), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-on-chrome-secondary)"
    }
  }, "Shanitah General Enterprises Ltd \xB7 Kampala, Uganda")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "var(--space-12)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "100%",
      maxWidth: 360
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      font: "var(--type-section-title)",
      fontSize: "var(--text-2xl)",
      color: "var(--text-heading)"
    }
  }, "Sign in"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-body-dense)",
      color: "var(--text-secondary)",
      marginTop: 6,
      marginBottom: "var(--space-6)"
    }
  }, "Use your organisation email. Super Admin and Finance require MFA."), mfa && /*#__PURE__*/React.createElement(Alert, {
    tone: "info",
    title: "Enter your 6-digit code",
    style: {
      marginBottom: "var(--space-4)"
    }
  }, "Sent to the authenticator app registered to this account."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-4)"
    }
  }, mfa ? /*#__PURE__*/React.createElement(FormField, {
    label: "Authentication code",
    required: true
  }, /*#__PURE__*/React.createElement(Input, {
    mono: true,
    placeholder: "000000",
    size: "lg"
  })) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(FormField, {
    label: "Work email",
    required: true
  }, /*#__PURE__*/React.createElement(Input, {
    iconLeft: "mail",
    placeholder: "you@company.co.ug",
    size: "lg",
    defaultValue: "aisha.nabirye@kangaruride.com"
  })), /*#__PURE__*/React.createElement(FormField, {
    label: "Password",
    required: true
  }, /*#__PURE__*/React.createElement(Input, {
    type: "password",
    iconLeft: "lock",
    placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
    size: "lg",
    defaultValue: "password"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement(Checkbox, {
    label: "Keep me signed in"
  }), /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      font: "var(--type-caption)"
    }
  }, "Forgot password?"))), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    fullWidth: true,
    iconRight: "arrow-right",
    onClick: () => mfa ? onSignIn() : setMfa(true)
  }, mfa ? "Verify and continue" : "Sign in"), mfa && /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    fullWidth: true,
    onClick: () => setMfa(false)
  }, "Back")))));
}
Object.assign(window, {
  LoginScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/platform/LoginScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/platform/TripDetailScreen.jsx
try { (() => {
Object.assign(window, window.KangaruRideDesignSystem_69b541);
function Field({
  label,
  children,
  mono
}) {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      font: "var(--type-caption)",
      color: "var(--text-secondary)",
      marginBottom: 2
    }
  }, label), mono ? /*#__PURE__*/React.createElement(Identifier, null, children) : /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-label)",
      color: "var(--text-body)"
    }
  }, children));
}
function OdometerCapture({
  moment,
  reading,
  time
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      border: "1px solid var(--border-default)",
      borderRadius: "var(--radius-md)",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "var(--space-2) var(--space-3)",
      background: "var(--surface-sunken)",
      borderBottom: "1px solid var(--border-default)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-label)",
      color: "var(--text-body)"
    }
  }, moment), /*#__PURE__*/React.createElement(Identifier, {
    size: "xs",
    tone: "muted"
  }, time)), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 92,
      background: "var(--kr-gray-100)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      color: "var(--text-secondary)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "camera",
    size: 18
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)"
    }
  }, "Dashboard photo \xB7 driver capture")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "var(--space-3)",
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement(Identifier, {
    size: "md"
  }, reading), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-secondary)"
    }
  }, "km")));
}
function TripDetailScreen({
  onBack
}) {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-2)",
      marginBottom: "var(--space-3)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    iconLeft: "arrow-left",
    onClick: onBack
  }, "Back to trips")), /*#__PURE__*/React.createElement(PageHead, {
    title: "Trip TRP-2026-04812",
    sub: "Centenary Bank \xB7 Head Office cost centre CC-1042 \xB7 rate card v4 (immutable)",
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      iconLeft: "file-text"
    }, "Trip report (PDF)"), /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      iconLeft: "receipt"
    }, "View invoice"), /*#__PURE__*/React.createElement(Button, {
      variant: "destructive",
      iconLeft: "circle-x"
    }, "Cancel trip"))
  }), /*#__PURE__*/React.createElement(Alert, {
    tone: "warning",
    title: "Odometer / GPS variance 4.2 km (threshold 3.0 km)",
    action: /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      size: "sm"
    }, "Resolve flag"),
    style: {
      marginBottom: "var(--space-6)"
    }
  }, "GPS route recorded 38.4 km; odometer recorded 42.6 km. Resolve before the trip is invoiced."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.5fr 1fr",
      gap: "var(--space-4)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-4)"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    title: "Route",
    subtitle: "Mapeera House \u2192 Entebbe International Airport",
    padding: "none",
    actions: /*#__PURE__*/React.createElement(StatusBadge, {
      state: "trip_started"
    })
  }, /*#__PURE__*/React.createElement(MapSurface, {
    height: 260,
    label: "GPS route history \xB7 1 ping / 10s"
  }, /*#__PURE__*/React.createElement(VehiclePin, {
    top: 120,
    left: 190,
    plate: "UBK 421J"
  }))), /*#__PURE__*/React.createElement(Card, {
    title: "The six required data points",
    subtitle: "Present on every completed trip \u2014 Centenary Bank acceptance criteria"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: "var(--space-4) var(--space-6)"
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Commenced",
    mono: true
  }, "2026-07-21 08:14:22"), /*#__PURE__*/React.createElement(Field, {
    label: "Completed",
    mono: true
  }, "2026-07-21 09:32:40"), /*#__PURE__*/React.createElement(Field, {
    label: "Vehicle registration"
  }, /*#__PURE__*/React.createElement(Identifier, {
    kind: "plate"
  }, "UBK 421J")), /*#__PURE__*/React.createElement(Field, {
    label: "Origin"
  }, "Mapeera House, Kampala"), /*#__PURE__*/React.createElement(Field, {
    label: "Destination"
  }, "Entebbe Int. Airport"), /*#__PURE__*/React.createElement(Field, {
    label: "Duration",
    mono: true
  }, "1h 18m"), /*#__PURE__*/React.createElement(Field, {
    label: "Opening odometer",
    mono: true
  }, "128,940 km"), /*#__PURE__*/React.createElement(Field, {
    label: "Closing odometer",
    mono: true
  }, "128,978 km"), /*#__PURE__*/React.createElement(Field, {
    label: "Distance travelled",
    mono: true
  }, "38.4 km (GPS)"))), /*#__PURE__*/React.createElement(Card, {
    title: "Odometer capture",
    subtitle: "Driver-entered readings, reconciled against GPS distance"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--space-4)"
    }
  }, /*#__PURE__*/React.createElement(OdometerCapture, {
    moment: "Trip started",
    reading: "128,940",
    time: "08:14:22"
  }), /*#__PURE__*/React.createElement(OdometerCapture, {
    moment: "Trip completed",
    reading: "128,982",
    time: "09:32:40"
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-4)"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    title: "Assignment"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-3)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-3)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 36,
      height: 36,
      borderRadius: "var(--radius-pill)",
      background: "var(--surface-accent)",
      color: "var(--text-accent)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      font: "var(--type-label)",
      fontWeight: 600
    }
  }, "MO"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      font: "var(--type-label)",
      color: "var(--text-body)"
    }
  }, "Moses Okello"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-secondary)"
    }
  }, "Driver \xB7 Head Office depot"))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: "var(--border-default)"
    }
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Vehicle"
  }, /*#__PURE__*/React.createElement(Identifier, {
    kind: "plate"
  }, "UBK 421J")), /*#__PURE__*/React.createElement(Field, {
    label: "Category"
  }, "Saloon \xB7 Toyota Premio"), /*#__PURE__*/React.createElement(Field, {
    label: "Dispatched by"
  }, "Aisha Nabirye \xB7 07:58:44"), /*#__PURE__*/React.createElement(Field, {
    label: "Passenger"
  }, "J. Mubiru \xB7 Treasury"))), /*#__PURE__*/React.createElement(Card, {
    title: "Billing preview",
    subtitle: "Rate card v4 \xB7 reproducible from stored inputs"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-2)"
    }
  }, [["Distance 38.4 km × UGX 2,800", "107,520"], ["Waiting 12 min × UGX 500", "6,000"], ["Town zone base", "25,000"], ["Airport surcharge", "15,000"]].map(([k, v]) => /*#__PURE__*/React.createElement("div", {
    key: k,
    style: {
      display: "flex",
      justifyContent: "space-between",
      font: "var(--type-body-dense)",
      color: "var(--text-secondary)"
    }
  }, /*#__PURE__*/React.createElement("span", null, k), /*#__PURE__*/React.createElement("span", {
    className: "kr-tabular",
    style: {
      color: "var(--text-body)"
    }
  }, v))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: "var(--border-default)",
      margin: "var(--space-2) 0"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-label)"
    }
  }, "Total (UGX)"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-section-title)",
      fontFamily: "var(--font-display)",
      fontVariantNumeric: "tabular-nums"
    }
  }, "153,520")), /*#__PURE__*/React.createElement(Badge, {
    tone: "info",
    icon: "lock",
    style: {
      alignSelf: "flex-start",
      marginTop: 4
    }
  }, "Held \u2014 variance flag open"))), /*#__PURE__*/React.createElement(Card, {
    title: "Timeline",
    subtitle: "Append-only trip_events"
  }, /*#__PURE__*/React.createElement(TripTimeline, {
    events: [{
      label: "Booking created",
      time: "07:52:10",
      detail: "Corporate Admin · Centenary Bank"
    }, {
      label: "Assigned",
      time: "07:58:44",
      detail: "Aisha Nabirye → Moses Okello"
    }, {
      label: "Accepted",
      time: "07:59:31"
    }, {
      label: "Driver en route",
      time: "08:02:10"
    }, {
      label: "Driver arrived",
      time: "08:11:48"
    }, {
      label: "Trip started",
      time: "08:14:22",
      detail: "Opening odometer 128,940 km",
      meta: /*#__PURE__*/React.createElement(Badge, {
        tone: "brand",
        icon: "camera"
      }, "Dashboard photo")
    }, {
      label: "Waiting",
      time: "08:51:03",
      tone: "warning",
      icon: "pause",
      detail: "12 min billed per rate card"
    }, {
      label: "Trip resumed",
      time: "09:03:11"
    }, {
      label: "Trip completed",
      time: "09:32:40",
      detail: "Closing odometer 128,982 km"
    }, {
      label: "Variance flagged",
      time: "09:32:41",
      tone: "warning",
      icon: "triangle-alert",
      detail: "4.2 km above threshold"
    }, {
      label: "Invoice generated",
      done: false
    }, {
      label: "Closed",
      done: false
    }]
  })))));
}
Object.assign(window, {
  TripDetailScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/platform/TripDetailScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/platform/shared.jsx
try { (() => {
Object.assign(window, window.KangaruRideDesignSystem_69b541);

/* A stand-in for the Mapbox GL canvas. The real product renders live GPS,
   routes and geofences here; we do not reproduce map tiles. */
function MapSurface({
  height = 260,
  label = "Mapbox GL — live GPS, route and geofence layer",
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      height,
      borderRadius: "var(--radius-card)",
      overflow: "hidden",
      background: "linear-gradient(0deg, rgba(255,255,255,.06) 1px, transparent 1px) 0 0/100% 28px, linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px) 0 0/28px 100%, var(--surface-chrome)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      left: 12,
      bottom: 12,
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      font: "var(--type-caption)",
      color: "var(--text-on-chrome-secondary)",
      background: "var(--surface-chrome-elevated)",
      border: "1px solid var(--border-chrome)",
      borderRadius: "var(--radius-sm)",
      padding: "4px 8px"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "map",
    size: 12
  }), label), children);
}
function VehiclePin({
  top,
  left,
  plate,
  state = "trip_started"
}) {
  const color = state === "waiting" ? "var(--kr-warning)" : state === "driver_en_route" ? "var(--kr-info)" : "var(--action-primary)";
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top,
      left,
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 26,
      height: 26,
      borderRadius: "var(--radius-pill)",
      background: color,
      color: "#FBFBFB",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "var(--shadow-md)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "truck",
    size: 14
  })), /*#__PURE__*/React.createElement(Identifier, {
    size: "xs",
    kind: "chip",
    tone: "inverse"
  }, plate));
}
function PageHead({
  title,
  sub,
  actions
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "space-between",
      gap: "var(--space-4)",
      marginBottom: "var(--space-6)"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      font: "var(--type-page-title)",
      color: "var(--text-heading)"
    }
  }, title), sub && /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-body-dense)",
      color: "var(--text-secondary)",
      marginTop: 4
    }
  }, sub)), actions && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--gap-inline)"
    }
  }, actions));
}
function FilterBar({
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-2)",
      marginBottom: "var(--space-4)",
      flexWrap: "wrap"
    }
  }, children);
}
Object.assign(window, {
  MapSurface,
  VehiclePin,
  PageHead,
  FilterBar
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/platform/shared.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/BookingScreen.jsx
try { (() => {
Object.assign(window, window.KangaruRideDesignSystem_69b541);
function MapBlock({
  height = 320,
  label = "Mapbox GL — route preview"
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height,
      borderRadius: "var(--radius-card)",
      position: "relative",
      overflow: "hidden",
      background: "linear-gradient(0deg, rgba(255,255,255,.06) 1px, transparent 1px) 0 0/100% 28px, linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px) 0 0/28px 100%, var(--surface-chrome)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      left: 12,
      bottom: 12,
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      font: "var(--type-caption)",
      color: "var(--text-on-chrome-secondary)",
      background: "var(--surface-chrome-elevated)",
      border: "1px solid var(--border-chrome)",
      borderRadius: "var(--radius-sm)",
      padding: "4px 8px"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "map",
    size: 12
  }), label));
}
const RIDES = [{
  id: "saloon",
  name: "Saloon",
  seats: "1–3",
  eta: "4 min",
  price: "48,500",
  note: "Toyota Premio or similar"
}, {
  id: "suv",
  name: "SUV",
  seats: "1–4",
  eta: "7 min",
  price: "72,000",
  note: "Suited to upcountry routes"
}, {
  id: "van",
  name: "Van",
  seats: "5–13",
  eta: "12 min",
  price: "126,000",
  note: "Delegations and airport runs"
}];
function BookingScreen({
  onDone
}) {
  const [step, setStep] = React.useState(1);
  const [ride, setRide] = React.useState("saloon");
  const chosen = RIDES.find(r => r.id === ride);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1200,
      margin: "0 auto",
      padding: "var(--space-10) var(--space-6) var(--space-16)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-3)",
      marginBottom: "var(--space-6)"
    }
  }, ["Choose a vehicle", "Confirm details", "Track your driver"].map((l, i) => {
    const n = i + 1;
    const on = step >= n;
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: l
    }, i > 0 && /*#__PURE__*/React.createElement("span", {
      style: {
        flex: "0 0 32px",
        height: 1,
        background: "var(--border-default)"
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 24,
        height: 24,
        borderRadius: "var(--radius-pill)",
        background: on ? "var(--action-primary)" : "var(--surface-subtle)",
        color: on ? "var(--text-on-brand)" : "var(--text-secondary)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        font: "var(--type-caption)",
        fontWeight: 600
      }
    }, n), /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--type-label)",
        color: on ? "var(--text-body)" : "var(--text-secondary)"
      }
    }, l)));
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 420px",
      gap: "var(--space-6)",
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    padding: "none"
  }, /*#__PURE__*/React.createElement(MapBlock, {
    height: 430,
    label: step === 3 ? "Mapbox GL — live driver position" : "Mapbox GL — route preview"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-4)"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    padding: "sm"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-2)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-3)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "circle-dot",
    size: 14,
    style: {
      color: "var(--action-primary)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-body-dense)"
    }
  }, "Mapeera House, Kampala Road")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-3)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "square",
    size: 14,
    style: {
      color: "var(--text-secondary)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-body-dense)"
    }
  }, "Entebbe International Airport")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--space-2)",
      marginTop: 4
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "neutral",
    size: "sm",
    icon: "clock"
  }, "Now"), /*#__PURE__*/React.createElement(Badge, {
    tone: "neutral",
    size: "sm",
    icon: "ruler"
  }, "38.4 km est."), /*#__PURE__*/React.createElement(Badge, {
    tone: "brand",
    size: "sm",
    icon: "building-2"
  }, "Centenary Bank \xB7 CC-1042")))), step === 1 && /*#__PURE__*/React.createElement(Card, {
    title: "Choose a vehicle",
    subtitle: "Prices from your company rate card v4",
    padding: "none"
  }, RIDES.map(r => /*#__PURE__*/React.createElement("label", {
    key: r.id,
    onClick: () => setRide(r.id),
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-3)",
      padding: "var(--space-4)",
      borderBottom: "1px solid var(--border-default)",
      cursor: "pointer",
      background: ride === r.id ? "var(--surface-accent)" : "transparent"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 40,
      height: 40,
      borderRadius: "var(--radius-md)",
      background: "var(--surface-subtle)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--text-body)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: r.id === "van" ? "bus" : r.id === "suv" ? "car-front" : "car",
    size: 20
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      font: "var(--type-label)",
      color: "var(--text-body)"
    }
  }, r.name, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-secondary)"
    }
  }, "\xB7 ", r.seats)), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-secondary)"
    }
  }, r.eta, " away \xB7 ", r.note)), /*#__PURE__*/React.createElement("span", {
    className: "kr-tabular",
    style: {
      font: "var(--type-label)",
      fontWeight: 600
    }
  }, "UGX ", r.price))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "var(--space-4)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    fullWidth: true,
    iconRight: "arrow-right",
    onClick: () => setStep(2)
  }, "Continue with ", chosen.name))), step === 2 && /*#__PURE__*/React.createElement(Card, {
    title: "Confirm details"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-4)"
    }
  }, /*#__PURE__*/React.createElement(FormField, {
    label: "Passenger"
  }, /*#__PURE__*/React.createElement(Input, {
    defaultValue: "J. Mubiru \xB7 Treasury"
  })), /*#__PURE__*/React.createElement(FormField, {
    label: "Cost centre",
    required: true
  }, /*#__PURE__*/React.createElement(Select, {
    defaultValue: "cc1042",
    options: [{
      value: "cc1042",
      label: "CC-1042 · Treasury"
    }, {
      value: "cc2011",
      label: "CC-2011 · Audit"
    }]
  })), /*#__PURE__*/React.createElement(FormField, {
    label: "Note for the driver",
    hint: "Optional"
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "e.g. Collect from the west gate"
  })), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Return trip",
    description: "Adds a second leg at the same rate"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      padding: "var(--space-3) 0",
      borderTop: "1px solid var(--border-default)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-label)"
    }
  }, "Estimated total"), /*#__PURE__*/React.createElement("span", {
    className: "kr-tabular",
    style: {
      font: "var(--type-section-title)",
      fontFamily: "var(--font-display)"
    }
  }, "UGX ", chosen.price)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--space-2)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "lg",
    onClick: () => setStep(1)
  }, "Back"), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    fullWidth: true,
    iconLeft: "check",
    onClick: () => setStep(3)
  }, "Confirm booking")))), step === 3 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Alert, {
    tone: "success",
    title: "Booking BKG-2026-11241 confirmed"
  }, "Your driver has accepted and is on the way."), /*#__PURE__*/React.createElement(Card, {
    title: "Your driver",
    actions: /*#__PURE__*/React.createElement(StatusBadge, {
      state: "driver_en_route",
      size: "sm"
    })
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-3)",
      marginBottom: "var(--space-4)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 44,
      height: 44,
      borderRadius: "var(--radius-pill)",
      background: "var(--surface-accent)",
      color: "var(--text-accent)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      font: "var(--type-label)",
      fontWeight: 600
    }
  }, "MO"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      font: "var(--type-label)"
    }
  }, "Moses Okello"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-secondary)"
    }
  }, "Saloon \xB7 Toyota Premio")), /*#__PURE__*/React.createElement(Identifier, {
    kind: "plate"
  }, "UBK 421J")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--space-2)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true,
    iconLeft: "phone"
  }, "Call"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true,
    iconLeft: "message-square"
  }, "Message"))), /*#__PURE__*/React.createElement(Card, {
    title: "Progress"
  }, /*#__PURE__*/React.createElement(TripTimeline, {
    events: [{
      label: "Booking confirmed",
      time: "08:02:14"
    }, {
      label: "Driver en route",
      time: "08:03:40",
      tone: "active",
      icon: "navigation",
      detail: "Arriving in 4 minutes"
    }, {
      label: "Driver arrived",
      done: false
    }, {
      label: "Trip started",
      done: false
    }, {
      label: "Trip completed",
      done: false
    }]
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    fullWidth: true,
    onClick: onDone,
    style: {
      marginTop: "var(--space-3)"
    }
  }, "Back to home"))))));
}
Object.assign(window, {
  BookingScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/BookingScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/HomeScreen.jsx
try { (() => {
Object.assign(window, window.KangaruRideDesignSystem_69b541);
function BookingPanel({
  onSubmit
}) {
  const [when, setWhen] = React.useState("now");
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--surface-card)",
      borderRadius: "var(--radius-xl)",
      boxShadow: "var(--shadow-lg)",
      padding: "var(--space-6)",
      width: 400
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    variant: "pill",
    tabs: [{
      value: "ride",
      label: "Ride"
    }, {
      value: "corporate",
      label: "Corporate account"
    }],
    style: {
      marginBottom: "var(--space-5)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-3)"
    }
  }, /*#__PURE__*/React.createElement(FormField, {
    label: "Pickup"
  }, /*#__PURE__*/React.createElement(Input, {
    size: "lg",
    iconLeft: "circle-dot",
    placeholder: "Enter pickup location"
  })), /*#__PURE__*/React.createElement(FormField, {
    label: "Destination"
  }, /*#__PURE__*/React.createElement(Input, {
    size: "lg",
    iconLeft: "square",
    placeholder: "Where to?"
  })), /*#__PURE__*/React.createElement(RadioGroup, {
    layout: "horizontal",
    value: when,
    onChange: setWhen,
    options: [{
      value: "now",
      label: "Now"
    }, {
      value: "later",
      label: "Schedule"
    }],
    style: {
      marginTop: 2
    }
  }), when === "later" && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--space-2)"
    }
  }, /*#__PURE__*/React.createElement(FormField, {
    label: "Date",
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Input, {
    type: "date",
    defaultValue: "2026-07-28"
  })), /*#__PURE__*/React.createElement(FormField, {
    label: "Time",
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Input, {
    type: "time",
    defaultValue: "08:30"
  }))), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    fullWidth: true,
    iconRight: "arrow-right",
    onClick: onSubmit,
    style: {
      marginTop: "var(--space-2)"
    }
  }, "See prices"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-secondary)",
      textAlign: "center"
    }
  }, "Corporate employees: bookings are charged to your company cost centre.")));
}
function HomeScreen({
  onBook
}) {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("section", {
    style: {
      background: "var(--surface-chrome)",
      padding: "var(--space-20) var(--space-6)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1200,
      margin: "0 auto",
      display: "flex",
      alignItems: "center",
      gap: "var(--space-16)",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "1 1 420px"
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "brand",
    icon: "shield-check"
  }, "For safety and reliability"), /*#__PURE__*/React.createElement("h1", {
    style: {
      font: "var(--type-page-title)",
      fontSize: 52,
      lineHeight: 1.05,
      color: "var(--text-on-chrome)",
      marginTop: "var(--space-4)",
      maxWidth: 560
    }
  }, "Corporate transport, fully accounted for"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-body)",
      fontSize: "var(--text-lg)",
      color: "var(--text-on-chrome-secondary)",
      marginTop: "var(--space-5)",
      maxWidth: 520
    }
  }, "Book a vehicle in seconds. Every trip is tracked by GPS, every kilometre reconciled against the odometer, and every invoice reproducible from the record."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--space-6)",
      marginTop: "var(--space-8)",
      flexWrap: "wrap"
    }
  }, [["10,000", "trips a day at target scale"], ["6", "data points on every trip report"], ["99.5%", "uptime target"]].map(([n, l]) => /*#__PURE__*/React.createElement("div", {
    key: l
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--type-kpi)",
      fontSize: "var(--text-3xl)",
      color: "var(--action-primary)"
    }
  }, n), /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-on-chrome-secondary)",
      maxWidth: 140
    }
  }, l))))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "0 0 auto"
    }
  }, /*#__PURE__*/React.createElement(BookingPanel, {
    onSubmit: onBook
  })))), /*#__PURE__*/React.createElement(Section, {
    eyebrow: "Why KangaruRide",
    title: "Built for the people who have to answer for the trip",
    sub: "Dispatchers, fleet owners, finance teams and auditors work from the same record \u2014 not from a paper log book."
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: "var(--space-4)"
    }
  }, [["gauge", "Odometer + GPS reconciled", "Drivers capture opening and closing readings with a dashboard photo. Variance against GPS distance is flagged automatically."], ["receipt", "Billing you can defend", "Rate cards are versioned and immutable once used. Every invoice regenerates from stored inputs, to the shilling."], ["shield-check", "Auditable by design", "An append-only log records who changed what, before and after, when, and from where — queryable by your own admins."], ["map", "Live tracking", "Position freshness under 15 seconds, route history retained for 12 months, geofenced pricing zones."], ["wifi-off", "Works upcountry", "Trip capture continues offline and syncs when the vehicle reconnects. Odometer photos queue locally."], ["file-text", "Reports that close the month", "Trip, driver, vehicle and financial reports to PDF, Excel and CSV — invoices out within one business day of month close."]].map(([icon, h, p]) => /*#__PURE__*/React.createElement("div", {
    key: h,
    style: {
      background: "var(--surface-card)",
      border: "1px solid var(--border-default)",
      borderRadius: "var(--radius-card)",
      padding: "var(--space-6)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 40,
      height: 40,
      borderRadius: "var(--radius-md)",
      background: "var(--surface-accent)",
      color: "var(--text-accent)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 20
  })), /*#__PURE__*/React.createElement("h3", {
    style: {
      marginTop: "var(--space-4)",
      color: "var(--text-heading)"
    }
  }, h), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-body-dense)",
      color: "var(--text-secondary)",
      marginTop: "var(--space-2)"
    }
  }, p))))), /*#__PURE__*/React.createElement(Section, {
    tone: "sunken",
    eyebrow: "How it works",
    title: "From request to invoice, without paperwork"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4,1fr)",
      gap: "var(--space-6)"
    }
  }, [["Request", "An employee books immediately or schedules ahead, against a cost centre."], ["Dispatch", "Operations assigns an eligible driver and vehicle; the assignment locks."], ["Trip", "GPS records the route; the driver captures odometer readings and photos."], ["Invoice", "The rate card prices the trip; the monthly invoice reconciles automatically."]].map(([h, p], i) => /*#__PURE__*/React.createElement("div", {
    key: h
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--type-kpi)",
      fontSize: "var(--text-2xl)",
      color: "var(--action-primary)"
    }
  }, "0" + (i + 1)), /*#__PURE__*/React.createElement("h3", {
    style: {
      marginTop: "var(--space-2)",
      color: "var(--text-heading)"
    }
  }, h), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-body-dense)",
      color: "var(--text-secondary)",
      marginTop: "var(--space-2)"
    }
  }, p))))), /*#__PURE__*/React.createElement(Section, {
    tone: "dark",
    eyebrow: "Vehicle categories",
    title: "One account, the whole fleet",
    sub: "Rate cards price each category per zone, with night, weekend and holiday rates configured per client."
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4,1fr)",
      gap: "var(--space-4)"
    }
  }, [["Saloon", "1–3 passengers", "car"], ["SUV", "1–4 passengers · upcountry", "car-front"], ["Van", "5–13 passengers", "bus"], ["Truck", "Logistics & hire", "truck"]].map(([n, d, ic]) => /*#__PURE__*/React.createElement("div", {
    key: n,
    style: {
      background: "var(--surface-chrome-elevated)",
      border: "1px solid var(--border-chrome)",
      borderRadius: "var(--radius-card)",
      padding: "var(--space-5)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: ic,
    size: 22,
    style: {
      color: "var(--action-primary)"
    }
  }), /*#__PURE__*/React.createElement("h3", {
    style: {
      color: "var(--text-on-chrome)",
      marginTop: "var(--space-3)"
    }
  }, n), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-caption)",
      color: "var(--text-on-chrome-secondary)",
      marginTop: 4
    }
  }, d))))), /*#__PURE__*/React.createElement(Section, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "var(--space-8)",
      background: "var(--surface-accent)",
      border: "1px solid var(--kr-green-tint)",
      borderRadius: "var(--radius-xl)",
      padding: "var(--space-10)",
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 560
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      font: "var(--type-page-title)",
      color: "var(--text-heading)"
    }
  }, "Move your fleet onto the record"), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-body)",
      color: "var(--text-secondary)",
      marginTop: "var(--space-3)"
    }
  }, "Tell us how many vehicles you run and where they operate. We will set up a tenant, load your rate card and run a parallel month against your current billing.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--space-2)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "lg"
  }, "Talk to us"), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    iconRight: "arrow-right",
    onClick: onBook
  }, "Book a ride")))));
}
Object.assign(window, {
  HomeScreen,
  BookingPanel
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/HomeScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/website/shared.jsx
try { (() => {
Object.assign(window, window.KangaruRideDesignSystem_69b541);

/* No brand photography was supplied with the brief. Rather than invent imagery,
   full-bleed sections use the navy brand surface. Drop real photography into
   these blocks when it exists — see ui_kits/website/README.md. */
function SiteHeader({
  onBook
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      position: "sticky",
      top: 0,
      zIndex: 20,
      background: "var(--surface-chrome)",
      borderBottom: "1px solid var(--border-chrome)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1200,
      margin: "0 auto",
      height: 72,
      display: "flex",
      alignItems: "center",
      gap: "var(--space-8)",
      padding: "0 var(--space-6)"
    }
  }, /*#__PURE__*/React.createElement(Logo, {
    variant: "horizontal-navy",
    height: 30,
    basePath: "../../assets"
  }), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-6)",
      marginLeft: "var(--space-4)"
    }
  }, ["Corporate transport", "Fleet management", "Pricing", "About"].map(l => /*#__PURE__*/React.createElement("a", {
    key: l,
    href: "#",
    style: {
      font: "var(--type-label)",
      color: "var(--text-on-chrome-secondary)",
      textDecoration: "none"
    }
  }, l))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      display: "flex",
      alignItems: "center",
      gap: "var(--space-2)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    onChrome: true
  }, "Sign in"), /*#__PURE__*/React.createElement(Button, {
    iconRight: "arrow-right",
    onClick: onBook
  }, "Book a ride"))));
}
function SiteFooter() {
  const cols = [["Platform", ["Corporate bookings", "Dispatch", "GPS tracking", "Billing & reports"]], ["Company", ["About KangaruRide", "Shanitah General Enterprises", "Careers", "Contact"]], ["Support", ["Help centre", "Service status", "Terms", "Privacy"]]];
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      background: "var(--surface-chrome)",
      borderTop: "1px solid var(--border-chrome)",
      padding: "var(--space-12) var(--space-6) var(--space-8)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1200,
      margin: "0 auto",
      display: "grid",
      gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
      gap: "var(--space-8)"
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Logo, {
    variant: "horizontal-navy",
    height: 30,
    basePath: "../../assets"
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-body-dense)",
      color: "var(--text-on-chrome-secondary)",
      marginTop: "var(--space-4)",
      maxWidth: 260
    }
  }, "Enterprise transport management for corporate fleets across Uganda and East Africa.")), cols.map(([h, items]) => /*#__PURE__*/React.createElement("div", {
    key: h
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-overline)",
      textTransform: "uppercase",
      letterSpacing: "var(--tracking-caps)",
      color: "var(--text-on-chrome)",
      marginBottom: "var(--space-3)"
    }
  }, h), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-2)"
    }
  }, items.map(i => /*#__PURE__*/React.createElement("a", {
    key: i,
    href: "#",
    style: {
      font: "var(--type-body-dense)",
      color: "var(--text-on-chrome-secondary)",
      textDecoration: "none"
    }
  }, i)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1200,
      margin: "var(--space-8) auto 0",
      paddingTop: "var(--space-6)",
      borderTop: "1px solid var(--border-chrome)",
      display: "flex",
      justifyContent: "space-between",
      font: "var(--type-caption)",
      color: "var(--text-on-chrome-secondary)"
    }
  }, /*#__PURE__*/React.createElement("span", null, "\xA9 2026 Shanitah General Enterprises Ltd"), /*#__PURE__*/React.createElement("span", null, "Kampala, Uganda")));
}
function Section({
  eyebrow,
  title,
  sub,
  children,
  tone = "light",
  style
}) {
  const dark = tone === "dark";
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: dark ? "var(--surface-chrome)" : tone === "sunken" ? "var(--surface-sunken)" : "var(--surface-page)",
      padding: "var(--space-20) var(--space-6)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1200,
      margin: "0 auto"
    }
  }, eyebrow && /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-overline)",
      textTransform: "uppercase",
      letterSpacing: "var(--tracking-caps)",
      color: dark ? "var(--action-primary)" : "var(--text-accent)",
      marginBottom: "var(--space-3)"
    }
  }, eyebrow), title && /*#__PURE__*/React.createElement("h2", {
    style: {
      font: "var(--type-page-title)",
      fontSize: "var(--text-4xl)",
      color: dark ? "var(--text-on-chrome)" : "var(--text-heading)",
      maxWidth: 720
    }
  }, title), sub && /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--type-body)",
      color: dark ? "var(--text-on-chrome-secondary)" : "var(--text-secondary)",
      marginTop: "var(--space-4)",
      maxWidth: 640
    }
  }, sub), children && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--space-10)"
    }
  }, children)));
}
Object.assign(window, {
  SiteHeader,
  SiteFooter,
  Section
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/website/shared.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Logo = __ds_scope.Logo;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Identifier = __ds_scope.Identifier;

__ds_ns.TRIP_STATES = __ds_scope.TRIP_STATES;

__ds_ns.StatusBadge = __ds_scope.StatusBadge;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.DataTable = __ds_scope.DataTable;

__ds_ns.KPIStat = __ds_scope.KPIStat;

__ds_ns.Pagination = __ds_scope.Pagination;

__ds_ns.TripTimeline = __ds_scope.TripTimeline;

__ds_ns.Alert = __ds_scope.Alert;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.EmptyState = __ds_scope.EmptyState;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.FormField = __ds_scope.FormField;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.RadioGroup = __ds_scope.RadioGroup;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Breadcrumbs = __ds_scope.Breadcrumbs;

__ds_ns.SidebarNav = __ds_scope.SidebarNav;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.Topbar = __ds_scope.Topbar;

})();
