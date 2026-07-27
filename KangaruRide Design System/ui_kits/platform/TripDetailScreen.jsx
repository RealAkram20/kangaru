Object.assign(window, window.KangaruRideDesignSystem_69b541);

function Field({ label, children, mono }) {
  return (
    <div>
      <span style={{ display: "block", font: "var(--type-caption)", color: "var(--text-secondary)", marginBottom: 2 }}>{label}</span>
      {mono ? <Identifier>{children}</Identifier> : <span style={{ font: "var(--type-label)", color: "var(--text-body)" }}>{children}</span>}
    </div>
  );
}

function OdometerCapture({ moment, reading, time }) {
  return (
    <div style={{ flex: 1, border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-2) var(--space-3)", background: "var(--surface-sunken)", borderBottom: "1px solid var(--border-default)" }}>
        <span style={{ font: "var(--type-label)", color: "var(--text-body)" }}>{moment}</span>
        <Identifier size="xs" tone="muted">{time}</Identifier>
      </div>
      <div style={{ height: 92, background: "var(--kr-gray-100)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, color: "var(--text-secondary)" }}>
        <Icon name="camera" size={18} />
        <span style={{ font: "var(--type-caption)" }}>Dashboard photo · driver capture</span>
      </div>
      <div style={{ padding: "var(--space-3)", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <Identifier size="md">{reading}</Identifier>
        <span style={{ font: "var(--type-caption)", color: "var(--text-secondary)" }}>km</span>
      </div>
    </div>
  );
}

function TripDetailScreen({ onBack }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
        <Button variant="ghost" size="sm" iconLeft="arrow-left" onClick={onBack}>Back to trips</Button>
      </div>
      <PageHead
        title="Trip TRP-2026-04812"
        sub="Centenary Bank · Head Office cost centre CC-1042 · rate card v4 (immutable)"
        actions={
          <>
            <Button variant="secondary" iconLeft="file-text">Trip report (PDF)</Button>
            <Button variant="secondary" iconLeft="receipt">View invoice</Button>
            <Button variant="destructive" iconLeft="circle-x">Cancel trip</Button>
          </>
        }
      />
      <Alert tone="warning" title="Odometer / GPS variance 4.2 km (threshold 3.0 km)" action={<Button variant="secondary" size="sm">Resolve flag</Button>} style={{ marginBottom: "var(--space-6)" }}>
        GPS route recorded 38.4 km; odometer recorded 42.6 km. Resolve before the trip is invoiced.
      </Alert>

      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: "var(--space-4)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <Card title="Route" subtitle="Mapeera House → Entebbe International Airport" padding="none" actions={<StatusBadge state="trip_started" />}>
            <MapSurface height={260} label="GPS route history · 1 ping / 10s">
              <VehiclePin top={120} left={190} plate="UBK 421J" />
            </MapSurface>
          </Card>

          <Card title="The six required data points" subtitle="Present on every completed trip — Centenary Bank acceptance criteria">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-4) var(--space-6)" }}>
              <Field label="Commenced" mono>2026-07-21 08:14:22</Field>
              <Field label="Completed" mono>2026-07-21 09:32:40</Field>
              <Field label="Vehicle registration">
                <Identifier kind="plate">UBK 421J</Identifier>
              </Field>
              <Field label="Origin">Mapeera House, Kampala</Field>
              <Field label="Destination">Entebbe Int. Airport</Field>
              <Field label="Duration" mono>1h 18m</Field>
              <Field label="Opening odometer" mono>128,940 km</Field>
              <Field label="Closing odometer" mono>128,978 km</Field>
              <Field label="Distance travelled" mono>38.4 km (GPS)</Field>
            </div>
          </Card>

          <Card title="Odometer capture" subtitle="Driver-entered readings, reconciled against GPS distance">
            <div style={{ display: "flex", gap: "var(--space-4)" }}>
              <OdometerCapture moment="Trip started" reading="128,940" time="08:14:22" />
              <OdometerCapture moment="Trip completed" reading="128,982" time="09:32:40" />
            </div>
          </Card>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <Card title="Assignment">
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <span style={{ width: 36, height: 36, borderRadius: "var(--radius-pill)", background: "var(--surface-accent)", color: "var(--text-accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "var(--type-label)", fontWeight: 600 }}>MO</span>
                <span>
                  <span style={{ display: "block", font: "var(--type-label)", color: "var(--text-body)" }}>Moses Okello</span>
                  <span style={{ font: "var(--type-caption)", color: "var(--text-secondary)" }}>Driver · Head Office depot</span>
                </span>
              </div>
              <div style={{ height: 1, background: "var(--border-default)" }} />
              <Field label="Vehicle"><Identifier kind="plate">UBK 421J</Identifier></Field>
              <Field label="Category">Saloon · Toyota Premio</Field>
              <Field label="Dispatched by">Aisha Nabirye · 07:58:44</Field>
              <Field label="Passenger">J. Mubiru · Treasury</Field>
            </div>
          </Card>

          <Card title="Billing preview" subtitle="Rate card v4 · reproducible from stored inputs">
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {[
                ["Distance 38.4 km × UGX 2,800", "107,520"],
                ["Waiting 12 min × UGX 500", "6,000"],
                ["Town zone base", "25,000"],
                ["Airport surcharge", "15,000"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", font: "var(--type-body-dense)", color: "var(--text-secondary)" }}>
                  <span>{k}</span>
                  <span className="kr-tabular" style={{ color: "var(--text-body)" }}>{v}</span>
                </div>
              ))}
              <div style={{ height: 1, background: "var(--border-default)", margin: "var(--space-2) 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ font: "var(--type-label)" }}>Total (UGX)</span>
                <span style={{ font: "var(--type-section-title)", fontFamily: "var(--font-display)", fontVariantNumeric: "tabular-nums" }}>153,520</span>
              </div>
              <Badge tone="info" icon="lock" style={{ alignSelf: "flex-start", marginTop: 4 }}>Held — variance flag open</Badge>
            </div>
          </Card>

          <Card title="Timeline" subtitle="Append-only trip_events">
            <TripTimeline
              events={[
                { label: "Booking created", time: "07:52:10", detail: "Corporate Admin · Centenary Bank" },
                { label: "Assigned", time: "07:58:44", detail: "Aisha Nabirye → Moses Okello" },
                { label: "Accepted", time: "07:59:31" },
                { label: "Driver en route", time: "08:02:10" },
                { label: "Driver arrived", time: "08:11:48" },
                { label: "Trip started", time: "08:14:22", detail: "Opening odometer 128,940 km", meta: <Badge tone="brand" icon="camera">Dashboard photo</Badge> },
                { label: "Waiting", time: "08:51:03", tone: "warning", icon: "pause", detail: "12 min billed per rate card" },
                { label: "Trip resumed", time: "09:03:11" },
                { label: "Trip completed", time: "09:32:40", detail: "Closing odometer 128,982 km" },
                { label: "Variance flagged", time: "09:32:41", tone: "warning", icon: "triangle-alert", detail: "4.2 km above threshold" },
                { label: "Invoice generated", done: false },
                { label: "Closed", done: false },
              ]}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { TripDetailScreen });
