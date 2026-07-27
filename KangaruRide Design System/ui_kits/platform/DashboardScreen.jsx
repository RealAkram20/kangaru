Object.assign(window, window.KangaruRideDesignSystem_69b541);

const LIVE_ROWS = [
  { id: 1, trip: "TRP-2026-04812", plate: "UBK 421J", driver: "Moses Okello", route: "Mapeera House → Entebbe Airport", dist: "38.4", dur: "1h 18m", state: "trip_started" },
  { id: 2, trip: "TRP-2026-04811", plate: "UAX 908K", driver: "Sarah Achieng", route: "Nakawa Branch → Ntinda", dist: "12.1", dur: "0h 34m", state: "waiting" },
  { id: 3, trip: "TRP-2026-04810", plate: "UBG 117D", driver: "Peter Kagoro", route: "Head Office → Mbarara Branch", dist: "268.9", dur: "5h 02m", state: "driver_en_route" },
  { id: 4, trip: "TRP-2026-04808", plate: "UAP 553M", driver: "Grace Namuli", route: "Kololo → Head Office", dist: "6.2", dur: "0h 19m", state: "passenger_onboard" },
  { id: 5, trip: "TRP-2026-04807", plate: "UBJ 210Q", driver: "Ismail Wasswa", route: "Head Office → Jinja Branch", dist: "82.5", dur: "1h 51m", state: "trip_completed" },
];

const LIVE_COLS = [
  { key: "trip", header: "Trip ID", render: (r) => <Identifier kind="chip">{r.trip}</Identifier> },
  { key: "plate", header: "Vehicle", render: (r) => <Identifier kind="plate">{r.plate}</Identifier> },
  { key: "driver", header: "Driver", sortable: true },
  { key: "route", header: "Route", wrap: false },
  { key: "dist", header: "Distance (km)", numeric: true, sortable: true },
  { key: "dur", header: "Duration", numeric: true },
  { key: "state", header: "Status", render: (r) => <StatusBadge state={r.state} size="sm" /> },
];

function DashboardScreen({ onOpenTrip }) {
  return (
    <div>
      <PageHead
        title="Operations dashboard"
        sub="Tuesday 21 July 2026 · Centenary Bank · all branches"
        actions={
          <>
            <Button variant="secondary" iconLeft="download">Export day report</Button>
            <Button iconLeft="plus">New booking</Button>
          </>
        }
      />
      <Alert tone="warning" title="3 trips have an odometer / GPS variance above threshold" action={<Button variant="secondary" size="sm">Review flags</Button>} style={{ marginBottom: "var(--space-6)" }}>
        Variance flags must be reviewed within 2 business days before invoicing.
      </Alert>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-4)", marginBottom: "var(--space-6)" }}>
        <KPIStat label="Trips today" value="184" delta="+12%" hint="vs last Tuesday" icon="route" />
        <KPIStat label="Vehicles active" value="41" unit="/ 68" icon="truck" hint="27 idle at depots" />
        <KPIStat label="Distance today" value="4,182" unit="km" delta="+4%" icon="gauge" />
        <KPIStat tone="accent" label="Billed this month" value="41.2M" unit="UGX" icon="receipt" hint="Invoices due 1 Aug" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: "var(--space-4)", marginBottom: "var(--space-6)" }}>
        <Card title="Live fleet" subtitle="Position freshness under 15 seconds" padding="none" actions={<Button variant="secondary" size="sm" iconLeft="maximize-2">Full map</Button>}>
          <MapSurface height={300}>
            <VehiclePin top={60} left={90} plate="UBK 421J" />
            <VehiclePin top={150} left={260} plate="UAX 908K" state="waiting" />
            <VehiclePin top={220} left={120} plate="UBG 117D" state="driver_en_route" />
          </MapSurface>
        </Card>
        <Card title="Dispatch queue" subtitle="6 bookings awaiting assignment" actions={<Button variant="secondary" size="sm">Open board</Button>}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {[
              { t: "08:40", from: "Head Office", to: "Kampala Serena", cat: "Saloon", urgent: true },
              { t: "09:15", from: "Nakawa Branch", to: "Ntinda", cat: "SUV" },
              { t: "09:30", from: "Head Office", to: "Entebbe Airport", cat: "Van" },
              { t: "10:00", from: "Kololo", to: "Head Office", cat: "Saloon" },
            ].map((b, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", background: b.urgent ? "var(--surface-accent)" : "var(--surface-card)" }}>
                <Identifier size="xs">{b.t}</Identifier>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", font: "var(--type-label)", color: "var(--text-body)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.from} → {b.to}</span>
                  <span style={{ font: "var(--type-caption)", color: "var(--text-secondary)" }}>{b.cat}</span>
                </span>
                <Button size="sm" variant={b.urgent ? "primary" : "secondary"}>Assign</Button>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card title="Live and recent trips" padding="none" actions={<><Select size="sm" defaultValue="all" options={[{ value: "all", label: "All branches" }, { value: "hq", label: "Head Office" }]} /><Button variant="secondary" size="sm" iconLeft="filter">Filters</Button></>}>
        <DataTable dense columns={LIVE_COLS} rows={LIVE_ROWS} onRowClick={onOpenTrip} />
        <Pagination page={1} pageCount={8} pageSize={25} total={184} />
      </Card>
    </div>
  );
}

Object.assign(window, { DashboardScreen, LIVE_ROWS, LIVE_COLS });
