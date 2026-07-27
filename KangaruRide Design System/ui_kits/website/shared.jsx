Object.assign(window, window.KangaruRideDesignSystem_69b541);

/* No brand photography was supplied with the brief. Rather than invent imagery,
   full-bleed sections use the navy brand surface. Drop real photography into
   these blocks when it exists — see ui_kits/website/README.md. */
function SiteHeader({ onBook }) {
  return (
    <header style={{ position: "sticky", top: 0, zIndex: 20, background: "var(--surface-chrome)", borderBottom: "1px solid var(--border-chrome)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", height: 72, display: "flex", alignItems: "center", gap: "var(--space-8)", padding: "0 var(--space-6)" }}>
        <Logo variant="horizontal-navy" height={30} basePath="../../assets" />
        <nav style={{ display: "flex", alignItems: "center", gap: "var(--space-6)", marginLeft: "var(--space-4)" }}>
          {["Corporate transport", "Fleet management", "Pricing", "About"].map((l) => (
            <a key={l} href="#" style={{ font: "var(--type-label)", color: "var(--text-on-chrome-secondary)", textDecoration: "none" }}>{l}</a>
          ))}
        </nav>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <Button variant="ghost" onChrome>Sign in</Button>
          <Button iconRight="arrow-right" onClick={onBook}>Book a ride</Button>
        </div>
      </div>
    </header>
  );
}

function SiteFooter() {
  const cols = [
    ["Platform", ["Corporate bookings", "Dispatch", "GPS tracking", "Billing & reports"]],
    ["Company", ["About KangaruRide", "Shanitah General Enterprises", "Careers", "Contact"]],
    ["Support", ["Help centre", "Service status", "Terms", "Privacy"]],
  ];
  return (
    <footer style={{ background: "var(--surface-chrome)", borderTop: "1px solid var(--border-chrome)", padding: "var(--space-12) var(--space-6) var(--space-8)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: "var(--space-8)" }}>
        <div>
          <Logo variant="horizontal-navy" height={30} basePath="../../assets" />
          <p style={{ font: "var(--type-body-dense)", color: "var(--text-on-chrome-secondary)", marginTop: "var(--space-4)", maxWidth: 260 }}>
            Enterprise transport management for corporate fleets across Uganda and East Africa.
          </p>
        </div>
        {cols.map(([h, items]) => (
          <div key={h}>
            <p style={{ font: "var(--type-overline)", textTransform: "uppercase", letterSpacing: "var(--tracking-caps)", color: "var(--text-on-chrome)", marginBottom: "var(--space-3)" }}>{h}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {items.map((i) => (
                <a key={i} href="#" style={{ font: "var(--type-body-dense)", color: "var(--text-on-chrome-secondary)", textDecoration: "none" }}>{i}</a>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ maxWidth: 1200, margin: "var(--space-8) auto 0", paddingTop: "var(--space-6)", borderTop: "1px solid var(--border-chrome)", display: "flex", justifyContent: "space-between", font: "var(--type-caption)", color: "var(--text-on-chrome-secondary)" }}>
        <span>© 2026 Shanitah General Enterprises Ltd</span>
        <span>Kampala, Uganda</span>
      </div>
    </footer>
  );
}

function Section({ eyebrow, title, sub, children, tone = "light", style }) {
  const dark = tone === "dark";
  return (
    <section style={{ background: dark ? "var(--surface-chrome)" : tone === "sunken" ? "var(--surface-sunken)" : "var(--surface-page)", padding: "var(--space-20) var(--space-6)", ...style }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {eyebrow && (
          <p style={{ font: "var(--type-overline)", textTransform: "uppercase", letterSpacing: "var(--tracking-caps)", color: dark ? "var(--action-primary)" : "var(--text-accent)", marginBottom: "var(--space-3)" }}>{eyebrow}</p>
        )}
        {title && (
          <h2 style={{ font: "var(--type-page-title)", fontSize: "var(--text-4xl)", color: dark ? "var(--text-on-chrome)" : "var(--text-heading)", maxWidth: 720 }}>{title}</h2>
        )}
        {sub && (
          <p style={{ font: "var(--type-body)", color: dark ? "var(--text-on-chrome-secondary)" : "var(--text-secondary)", marginTop: "var(--space-4)", maxWidth: 640 }}>{sub}</p>
        )}
        {children && <div style={{ marginTop: "var(--space-10)" }}>{children}</div>}
      </div>
    </section>
  );
}

Object.assign(window, { SiteHeader, SiteFooter, Section });
