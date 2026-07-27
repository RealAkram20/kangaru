Object.assign(window, window.KangaruRideDesignSystem_69b541);

/* A stand-in for the Mapbox GL canvas. The real product renders live GPS,
   routes and geofences here; we do not reproduce map tiles. */
function MapSurface({ height = 260, label = "Mapbox GL — live GPS, route and geofence layer", children, style }) {
  return (
    <div
      style={{
        position: "relative",
        height,
        borderRadius: "var(--radius-card)",
        overflow: "hidden",
        background:
          "linear-gradient(0deg, rgba(255,255,255,.06) 1px, transparent 1px) 0 0/100% 28px, linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px) 0 0/28px 100%, var(--surface-chrome)",
        ...style,
      }}
    >
      <span
        style={{
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
          padding: "4px 8px",
        }}
      >
        <Icon name="map" size={12} />
        {label}
      </span>
      {children}
    </div>
  );
}

function VehiclePin({ top, left, plate, state = "trip_started" }) {
  const color = state === "waiting" ? "var(--kr-warning)" : state === "driver_en_route" ? "var(--kr-info)" : "var(--action-primary)";
  return (
    <span style={{ position: "absolute", top, left, display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 26, height: 26, borderRadius: "var(--radius-pill)", background: color, color: "#FBFBFB", display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "var(--shadow-md)" }}>
        <Icon name="truck" size={14} />
      </span>
      <Identifier size="xs" kind="chip" tone="inverse">{plate}</Identifier>
    </span>
  );
}

function PageHead({ title, sub, actions }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "var(--space-4)", marginBottom: "var(--space-6)" }}>
      <div>
        <h1 style={{ font: "var(--type-page-title)", color: "var(--text-heading)" }}>{title}</h1>
        {sub && <p style={{ font: "var(--type-body-dense)", color: "var(--text-secondary)", marginTop: 4 }}>{sub}</p>}
      </div>
      {actions && <div style={{ display: "flex", gap: "var(--gap-inline)" }}>{actions}</div>}
    </div>
  );
}

function FilterBar({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-4)", flexWrap: "wrap" }}>{children}</div>
  );
}

Object.assign(window, { MapSurface, VehiclePin, PageHead, FilterBar });
