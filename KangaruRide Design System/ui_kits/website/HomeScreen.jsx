Object.assign(window, window.KangaruRideDesignSystem_69b541);

function BookingPanel({ onSubmit }) {
  const [when, setWhen] = React.useState("now");
  return (
    <div style={{ background: "var(--surface-card)", borderRadius: "var(--radius-xl)", boxShadow: "var(--shadow-lg)", padding: "var(--space-6)", width: 400 }}>
      <Tabs variant="pill" tabs={[{ value: "ride", label: "Ride" }, { value: "corporate", label: "Corporate account" }]} style={{ marginBottom: "var(--space-5)" }} />
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <FormField label="Pickup"><Input size="lg" iconLeft="circle-dot" placeholder="Enter pickup location" /></FormField>
        <FormField label="Destination"><Input size="lg" iconLeft="square" placeholder="Where to?" /></FormField>
        <RadioGroup
          layout="horizontal"
          value={when}
          onChange={setWhen}
          options={[{ value: "now", label: "Now" }, { value: "later", label: "Schedule" }]}
          style={{ marginTop: 2 }}
        />
        {when === "later" && (
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <FormField label="Date" style={{ flex: 1 }}><Input type="date" defaultValue="2026-07-28" /></FormField>
            <FormField label="Time" style={{ flex: 1 }}><Input type="time" defaultValue="08:30" /></FormField>
          </div>
        )}
        <Button size="lg" fullWidth iconRight="arrow-right" onClick={onSubmit} style={{ marginTop: "var(--space-2)" }}>See prices</Button>
        <p style={{ font: "var(--type-caption)", color: "var(--text-secondary)", textAlign: "center" }}>
          Corporate employees: bookings are charged to your company cost centre.
        </p>
      </div>
    </div>
  );
}

function HomeScreen({ onBook }) {
  return (
    <div>
      <section style={{ background: "var(--surface-chrome)", padding: "var(--space-20) var(--space-6)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", gap: "var(--space-16)", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 420px" }}>
            <Badge tone="brand" icon="shield-check">For safety and reliability</Badge>
            <h1 style={{ font: "var(--type-page-title)", fontSize: 52, lineHeight: 1.05, color: "var(--text-on-chrome)", marginTop: "var(--space-4)", maxWidth: 560 }}>
              Corporate transport, fully accounted for
            </h1>
            <p style={{ font: "var(--type-body)", fontSize: "var(--text-lg)", color: "var(--text-on-chrome-secondary)", marginTop: "var(--space-5)", maxWidth: 520 }}>
              Book a vehicle in seconds. Every trip is tracked by GPS, every kilometre reconciled against the odometer, and every invoice reproducible from the record.
            </p>
            <div style={{ display: "flex", gap: "var(--space-6)", marginTop: "var(--space-8)", flexWrap: "wrap" }}>
              {[["10,000", "trips a day at target scale"], ["6", "data points on every trip report"], ["99.5%", "uptime target"]].map(([n, l]) => (
                <div key={l}>
                  <div style={{ font: "var(--type-kpi)", fontSize: "var(--text-3xl)", color: "var(--action-primary)" }}>{n}</div>
                  <div style={{ font: "var(--type-caption)", color: "var(--text-on-chrome-secondary)", maxWidth: 140 }}>{l}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex: "0 0 auto" }}>
            <BookingPanel onSubmit={onBook} />
          </div>
        </div>
      </section>

      <Section
        eyebrow="Why KangaruRide"
        title="Built for the people who have to answer for the trip"
        sub="Dispatchers, fleet owners, finance teams and auditors work from the same record — not from a paper log book."
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "var(--space-4)" }}>
          {[
            ["gauge", "Odometer + GPS reconciled", "Drivers capture opening and closing readings with a dashboard photo. Variance against GPS distance is flagged automatically."],
            ["receipt", "Billing you can defend", "Rate cards are versioned and immutable once used. Every invoice regenerates from stored inputs, to the shilling."],
            ["shield-check", "Auditable by design", "An append-only log records who changed what, before and after, when, and from where — queryable by your own admins."],
            ["map", "Live tracking", "Position freshness under 15 seconds, route history retained for 12 months, geofenced pricing zones."],
            ["wifi-off", "Works upcountry", "Trip capture continues offline and syncs when the vehicle reconnects. Odometer photos queue locally."],
            ["file-text", "Reports that close the month", "Trip, driver, vehicle and financial reports to PDF, Excel and CSV — invoices out within one business day of month close."],
          ].map(([icon, h, p]) => (
            <div key={h} style={{ background: "var(--surface-card)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-card)", padding: "var(--space-6)" }}>
              <span style={{ width: 40, height: 40, borderRadius: "var(--radius-md)", background: "var(--surface-accent)", color: "var(--text-accent)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name={icon} size={20} />
              </span>
              <h3 style={{ marginTop: "var(--space-4)", color: "var(--text-heading)" }}>{h}</h3>
              <p style={{ font: "var(--type-body-dense)", color: "var(--text-secondary)", marginTop: "var(--space-2)" }}>{p}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="sunken" eyebrow="How it works" title="From request to invoice, without paperwork">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "var(--space-6)" }}>
          {[
            ["Request", "An employee books immediately or schedules ahead, against a cost centre."],
            ["Dispatch", "Operations assigns an eligible driver and vehicle; the assignment locks."],
            ["Trip", "GPS records the route; the driver captures odometer readings and photos."],
            ["Invoice", "The rate card prices the trip; the monthly invoice reconciles automatically."],
          ].map(([h, p], i) => (
            <div key={h}>
              <span style={{ font: "var(--type-kpi)", fontSize: "var(--text-2xl)", color: "var(--action-primary)" }}>{"0" + (i + 1)}</span>
              <h3 style={{ marginTop: "var(--space-2)", color: "var(--text-heading)" }}>{h}</h3>
              <p style={{ font: "var(--type-body-dense)", color: "var(--text-secondary)", marginTop: "var(--space-2)" }}>{p}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        tone="dark"
        eyebrow="Vehicle categories"
        title="One account, the whole fleet"
        sub="Rate cards price each category per zone, with night, weekend and holiday rates configured per client."
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "var(--space-4)" }}>
          {[["Saloon", "1–3 passengers", "car"], ["SUV", "1–4 passengers · upcountry", "car-front"], ["Van", "5–13 passengers", "bus"], ["Truck", "Logistics & hire", "truck"]].map(([n, d, ic]) => (
            <div key={n} style={{ background: "var(--surface-chrome-elevated)", border: "1px solid var(--border-chrome)", borderRadius: "var(--radius-card)", padding: "var(--space-5)" }}>
              <Icon name={ic} size={22} style={{ color: "var(--action-primary)" }} />
              <h3 style={{ color: "var(--text-on-chrome)", marginTop: "var(--space-3)" }}>{n}</h3>
              <p style={{ font: "var(--type-caption)", color: "var(--text-on-chrome-secondary)", marginTop: 4 }}>{d}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-8)", background: "var(--surface-accent)", border: "1px solid var(--kr-green-tint)", borderRadius: "var(--radius-xl)", padding: "var(--space-10)", flexWrap: "wrap" }}>
          <div style={{ maxWidth: 560 }}>
            <h2 style={{ font: "var(--type-page-title)", color: "var(--text-heading)" }}>Move your fleet onto the record</h2>
            <p style={{ font: "var(--type-body)", color: "var(--text-secondary)", marginTop: "var(--space-3)" }}>
              Tell us how many vehicles you run and where they operate. We will set up a tenant, load your rate card and run a parallel month against your current billing.
            </p>
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <Button variant="secondary" size="lg">Talk to us</Button>
            <Button size="lg" iconRight="arrow-right" onClick={onBook}>Book a ride</Button>
          </div>
        </div>
      </Section>
    </div>
  );
}

Object.assign(window, { HomeScreen, BookingPanel });
