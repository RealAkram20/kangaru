Object.assign(window, window.KangaruRideDesignSystem_69b541);

const QUEUE = [
  { id: "BKG-2026-11204", time: "08:40", from: "Head Office, Mapeera House", to: "Kampala Serena Hotel", cat: "Saloon", passenger: "J. Mubiru · Treasury", zone: "Town", urgent: true },
  { id: "BKG-2026-11205", time: "09:15", from: "Nakawa Branch", to: "Ntinda Complex", cat: "SUV", passenger: "A. Kirabo · Audit", zone: "Town" },
  { id: "BKG-2026-11206", time: "09:30", from: "Head Office", to: "Entebbe Airport", cat: "Van", passenger: "Delegation (4)", zone: "Town" },
  { id: "BKG-2026-11207", time: "10:00", from: "Kololo Residence", to: "Head Office", cat: "Saloon", passenger: "R. Ssentongo · Exec", zone: "Town" },
  { id: "BKG-2026-11208", time: "11:00", from: "Head Office", to: "Mbarara Branch", cat: "SUV", passenger: "Inspection team (2)", zone: "Upcountry" },
  { id: "BKG-2026-11209", time: "13:30", from: "Jinja Branch", to: "Head Office", cat: "Saloon", passenger: "P. Nangobi · Ops", zone: "Upcountry" },
];

const CANDIDATES = [
  { name: "Moses Okello", plate: "UBK 421J", cat: "Saloon", depot: "Head Office", km: 1.2, status: "Available", pref: true },
  { name: "Grace Namuli", plate: "UAP 553M", cat: "Saloon", depot: "Head Office", km: 3.8, status: "Available" },
  { name: "Sarah Achieng", plate: "UAX 908K", cat: "SUV", depot: "Nakawa", km: 6.4, status: "On trip · ends 08:55" },
  { name: "Ismail Wasswa", plate: "UBJ 210Q", cat: "Van", depot: "Head Office", km: 2.1, status: "Available" },
];

function DispatchScreen() {
  const [selected, setSelected] = React.useState(QUEUE[0]);
  const [assigning, setAssigning] = React.useState(false);
  const [assigned, setAssigned] = React.useState([]);
  const [pick, setPick] = React.useState(CANDIDATES[0].plate);
  const queue = QUEUE.filter((q) => !assigned.includes(q.id));

  return (
    <div>
      <PageHead
        title="Dispatch board"
        sub="Manual and hybrid dispatch · assignment locks the driver and vehicle pessimistically"
        actions={
          <>
            <Button variant="secondary" iconLeft="settings-2">Dispatch rules</Button>
            <Button iconLeft="plus">New booking</Button>
          </>
        }
      />
      <Tabs
        tabs={[
          { value: "unassigned", label: "Unassigned", icon: "user-x", count: queue.length },
          { value: "assigned", label: "Assigned today", icon: "user-check", count: 178 },
          { value: "scheduled", label: "Scheduled", icon: "calendar-clock", count: 42 },
        ]}
        style={{ marginBottom: "var(--space-4)" }}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-4)" }}>
        <Card title="Booking queue" padding="none" subtitle="Oldest first">
          {queue.length === 0 ? (
            <EmptyState compact icon="route" title="Queue clear" description="Every booking for today has a driver and vehicle." />
          ) : (
            <div>
              {queue.map((b) => {
                const on = selected && selected.id === b.id;
                return (
                  <button
                    key={b.id}
                    onClick={() => setSelected(b)}
                    style={{
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
                      cursor: "pointer",
                    }}
                  >
                    <Identifier size="xs">{b.time}</Identifier>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", font: "var(--type-label)", color: "var(--text-body)" }}>{b.from} → {b.to}</span>
                      <span style={{ font: "var(--type-caption)", color: "var(--text-secondary)" }}>{b.passenger}</span>
                    </span>
                    <Badge tone={b.zone === "Upcountry" ? "info" : "neutral"} size="sm">{b.zone}</Badge>
                    <Badge tone="neutral" size="sm" outline>{b.cat}</Badge>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {selected && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <Card
              title={selected.from + " → " + selected.to}
              subtitle={selected.passenger}
              actions={<Identifier kind="chip">{selected.id}</Identifier>}
            >
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "var(--space-4)", marginBottom: "var(--space-4)" }}>
                {[
                  ["Pickup", selected.time + " today"],
                  ["Vehicle category", selected.cat],
                  ["Pricing zone", selected.zone],
                ].map(([k, v]) => (
                  <div key={k}>
                    <span style={{ display: "block", font: "var(--type-caption)", color: "var(--text-secondary)" }}>{k}</span>
                    <span style={{ font: "var(--type-label)", color: "var(--text-body)" }}>{v}</span>
                  </div>
                ))}
              </div>
              <MapSurface height={150} label="Route preview · Mapbox Directions" />
            </Card>
            <Card title="Eligible drivers and vehicles" subtitle="Filtered by category, geofence, depot and availability" padding="none">
              <div>
                {CANDIDATES.map((c) => (
                  <label
                    key={c.plate}
                    onClick={() => setPick(c.plate)}
                    style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--border-default)", cursor: "pointer", background: pick === c.plate ? "var(--surface-accent)" : "transparent" }}
                  >
                    <span style={{ width: 16, height: 16, borderRadius: "var(--radius-pill)", border: "1px solid " + (pick === c.plate ? "var(--action-primary)" : "var(--border-input)"), display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      {pick === c.plate && <span style={{ width: 8, height: 8, background: "var(--action-primary)", borderRadius: "var(--radius-pill)" }} />}
                    </span>
                    <span style={{ flex: 1 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--type-label)", color: "var(--text-body)" }}>
                        {c.name}
                        {c.pref && <Badge tone="brand" size="sm" icon="star">Preferred</Badge>}
                      </span>
                      <span style={{ font: "var(--type-caption)", color: "var(--text-secondary)" }}>{c.depot} depot · {c.km} km away · {c.status}</span>
                    </span>
                    <Identifier kind="plate" size="xs">{c.plate}</Identifier>
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--gap-inline)", padding: "var(--space-3) var(--space-4)" }}>
                <Button variant="secondary">Skip</Button>
                <Button iconLeft="user-check" onClick={() => setAssigning(true)}>Assign</Button>
              </div>
            </Card>
          </div>
        )}
      </div>

      <Dialog
        open={assigning}
        title="Confirm assignment"
        description={"This locks " + pick + " and its driver to " + (selected ? selected.id : "") + ". The driver is notified by SMS and the action is written to the audit log."}
        onClose={() => setAssigning(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAssigning(false)}>Back</Button>
            <Button
              iconLeft="check"
              onClick={() => {
                setAssigned((a) => [...a, selected.id]);
                setAssigning(false);
                const next = QUEUE.find((q) => q.id !== selected.id && ![...assigned, selected.id].includes(q.id));
                setSelected(next || null);
              }}
            >
              Confirm assignment
            </Button>
          </>
        }
      >
        <FormField label="Dispatch note (optional)" hint="Visible to the driver and stored on the trip record">
          <Input placeholder="e.g. Collect from the west gate" />
        </FormField>
      </Dialog>
    </div>
  );
}

Object.assign(window, { DispatchScreen });
