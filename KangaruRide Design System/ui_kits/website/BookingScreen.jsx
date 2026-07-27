Object.assign(window, window.KangaruRideDesignSystem_69b541);

function MapBlock({ height = 320, label = "Mapbox GL — route preview" }) {
  return (
    <div style={{ height, borderRadius: "var(--radius-card)", position: "relative", overflow: "hidden", background: "linear-gradient(0deg, rgba(255,255,255,.06) 1px, transparent 1px) 0 0/100% 28px, linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px) 0 0/28px 100%, var(--surface-chrome)" }}>
      <span style={{ position: "absolute", left: 12, bottom: 12, display: "inline-flex", alignItems: "center", gap: 6, font: "var(--type-caption)", color: "var(--text-on-chrome-secondary)", background: "var(--surface-chrome-elevated)", border: "1px solid var(--border-chrome)", borderRadius: "var(--radius-sm)", padding: "4px 8px" }}>
        <Icon name="map" size={12} />{label}
      </span>
    </div>
  );
}

const RIDES = [
  { id: "saloon", name: "Saloon", seats: "1–3", eta: "4 min", price: "48,500", note: "Toyota Premio or similar" },
  { id: "suv", name: "SUV", seats: "1–4", eta: "7 min", price: "72,000", note: "Suited to upcountry routes" },
  { id: "van", name: "Van", seats: "5–13", eta: "12 min", price: "126,000", note: "Delegations and airport runs" },
];

function BookingScreen({ onDone }) {
  const [step, setStep] = React.useState(1);
  const [ride, setRide] = React.useState("saloon");
  const chosen = RIDES.find((r) => r.id === ride);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "var(--space-10) var(--space-6) var(--space-16)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-6)" }}>
        {["Choose a vehicle", "Confirm details", "Track your driver"].map((l, i) => {
          const n = i + 1;
          const on = step >= n;
          return (
            <React.Fragment key={l}>
              {i > 0 && <span style={{ flex: "0 0 32px", height: 1, background: "var(--border-default)" }} />}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 24, height: 24, borderRadius: "var(--radius-pill)", background: on ? "var(--action-primary)" : "var(--surface-subtle)", color: on ? "var(--text-on-brand)" : "var(--text-secondary)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "var(--type-caption)", fontWeight: 600 }}>{n}</span>
                <span style={{ font: "var(--type-label)", color: on ? "var(--text-body)" : "var(--text-secondary)" }}>{l}</span>
              </span>
            </React.Fragment>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: "var(--space-6)", alignItems: "start" }}>
        <Card padding="none">
          <MapBlock height={430} label={step === 3 ? "Mapbox GL — live driver position" : "Mapbox GL — route preview"} />
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <Card padding="sm">
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <Icon name="circle-dot" size={14} style={{ color: "var(--action-primary)" }} />
                <span style={{ font: "var(--type-body-dense)" }}>Mapeera House, Kampala Road</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <Icon name="square" size={14} style={{ color: "var(--text-secondary)" }} />
                <span style={{ font: "var(--type-body-dense)" }}>Entebbe International Airport</span>
              </div>
              <div style={{ display: "flex", gap: "var(--space-2)", marginTop: 4 }}>
                <Badge tone="neutral" size="sm" icon="clock">Now</Badge>
                <Badge tone="neutral" size="sm" icon="ruler">38.4 km est.</Badge>
                <Badge tone="brand" size="sm" icon="building-2">Centenary Bank · CC-1042</Badge>
              </div>
            </div>
          </Card>

          {step === 1 && (
            <Card title="Choose a vehicle" subtitle="Prices from your company rate card v4" padding="none">
              {RIDES.map((r) => (
                <label key={r.id} onClick={() => setRide(r.id)} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-4)", borderBottom: "1px solid var(--border-default)", cursor: "pointer", background: ride === r.id ? "var(--surface-accent)" : "transparent" }}>
                  <span style={{ width: 40, height: 40, borderRadius: "var(--radius-md)", background: "var(--surface-subtle)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--text-body)" }}>
                    <Icon name={r.id === "van" ? "bus" : r.id === "suv" ? "car-front" : "car"} size={20} />
                  </span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--type-label)", color: "var(--text-body)" }}>{r.name}<span style={{ font: "var(--type-caption)", color: "var(--text-secondary)" }}>· {r.seats}</span></span>
                    <span style={{ font: "var(--type-caption)", color: "var(--text-secondary)" }}>{r.eta} away · {r.note}</span>
                  </span>
                  <span className="kr-tabular" style={{ font: "var(--type-label)", fontWeight: 600 }}>UGX {r.price}</span>
                </label>
              ))}
              <div style={{ padding: "var(--space-4)" }}>
                <Button size="lg" fullWidth iconRight="arrow-right" onClick={() => setStep(2)}>Continue with {chosen.name}</Button>
              </div>
            </Card>
          )}

          {step === 2 && (
            <Card title="Confirm details">
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                <FormField label="Passenger"><Input defaultValue="J. Mubiru · Treasury" /></FormField>
                <FormField label="Cost centre" required><Select defaultValue="cc1042" options={[{ value: "cc1042", label: "CC-1042 · Treasury" }, { value: "cc2011", label: "CC-2011 · Audit" }]} /></FormField>
                <FormField label="Note for the driver" hint="Optional"><Input placeholder="e.g. Collect from the west gate" /></FormField>
                <Checkbox label="Return trip" description="Adds a second leg at the same rate" />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "var(--space-3) 0", borderTop: "1px solid var(--border-default)" }}>
                  <span style={{ font: "var(--type-label)" }}>Estimated total</span>
                  <span className="kr-tabular" style={{ font: "var(--type-section-title)", fontFamily: "var(--font-display)" }}>UGX {chosen.price}</span>
                </div>
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  <Button variant="secondary" size="lg" onClick={() => setStep(1)}>Back</Button>
                  <Button size="lg" fullWidth iconLeft="check" onClick={() => setStep(3)}>Confirm booking</Button>
                </div>
              </div>
            </Card>
          )}

          {step === 3 && (
            <>
              <Alert tone="success" title="Booking BKG-2026-11241 confirmed">Your driver has accepted and is on the way.</Alert>
              <Card title="Your driver" actions={<StatusBadge state="driver_en_route" size="sm" />}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
                  <span style={{ width: 44, height: 44, borderRadius: "var(--radius-pill)", background: "var(--surface-accent)", color: "var(--text-accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "var(--type-label)", fontWeight: 600 }}>MO</span>
                  <span style={{ flex: 1 }}>
                    <span style={{ display: "block", font: "var(--type-label)" }}>Moses Okello</span>
                    <span style={{ font: "var(--type-caption)", color: "var(--text-secondary)" }}>Saloon · Toyota Premio</span>
                  </span>
                  <Identifier kind="plate">UBK 421J</Identifier>
                </div>
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  <Button variant="secondary" fullWidth iconLeft="phone">Call</Button>
                  <Button variant="secondary" fullWidth iconLeft="message-square">Message</Button>
                </div>
              </Card>
              <Card title="Progress">
                <TripTimeline events={[
                  { label: "Booking confirmed", time: "08:02:14" },
                  { label: "Driver en route", time: "08:03:40", tone: "active", icon: "navigation", detail: "Arriving in 4 minutes" },
                  { label: "Driver arrived", done: false },
                  { label: "Trip started", done: false },
                  { label: "Trip completed", done: false },
                ]} />
                <Button variant="ghost" fullWidth onClick={onDone} style={{ marginTop: "var(--space-3)" }}>Back to home</Button>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { BookingScreen });
