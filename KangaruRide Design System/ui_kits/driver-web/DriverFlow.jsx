Object.assign(window, window.KangaruRideDesignSystem_69b541);

function PhoneChrome({ children, title, right }) {
  return (
    <div style={{ width: 390, minHeight: 780, background: "var(--surface-page)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-2xl)", overflow: "hidden", boxShadow: "var(--shadow-lg)", display: "flex", flexDirection: "column" }}>
      <div style={{ background: "var(--surface-chrome)", padding: "var(--space-3) var(--space-4)", display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <Logo variant="mark-solid" height={26} basePath="../../assets" />
        <span style={{ flex: 1, font: "var(--type-label)", fontWeight: 600, color: "var(--text-on-chrome)" }}>{title}</span>
        {right}
      </div>
      <div style={{ flex: 1, padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>{children}</div>
    </div>
  );
}

function DriverRow({ label, value, mono }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-4)" }}>
      <span style={{ font: "var(--type-caption)", color: "var(--text-secondary)" }}>{label}</span>
      {mono ? <Identifier>{value}</Identifier> : <span style={{ font: "var(--type-label)", textAlign: "right" }}>{value}</span>}
    </div>
  );
}

function DriverFlow() {
  const [stage, setStage] = React.useState("assigned");
  const [odo, setOdo] = React.useState("");
  const [online, setOnline] = React.useState(true);

  const header = (
    <IconButton icon={online ? "wifi" : "wifi-off"} label={online ? "Online" : "Offline — trips queue locally"} onChrome onClick={() => setOnline(!online)} />
  );

  return (
    <PhoneChrome title="Driver · Moses Okello" right={header}>
      {!online && (
        <Alert tone="info" title="Offline">Captures are stored on this device and sync when you reconnect.</Alert>
      )}

      {stage === "assigned" && (
        <>
          <Card title="Next trip" subtitle="Assigned 07:58" actions={<StatusBadge state="assigned" size="sm" />}>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <DriverRow label="Pickup" value="Mapeera House, Kampala Rd" />
              <DriverRow label="Destination" value="Entebbe Int. Airport" />
              <DriverRow label="Passenger" value="J. Mubiru · Treasury" />
              <DriverRow label="Vehicle" value="UBK 421J" mono />
              <DriverRow label="Trip" value="TRP-2026-04812" mono />
            </div>
          </Card>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginTop: "auto" }}>
            <Button size="lg" fullWidth iconLeft="check" onClick={() => setStage("enroute")}>Accept trip</Button>
            <Button size="lg" fullWidth variant="secondary">Reject — recorded against me</Button>
          </div>
        </>
      )}

      {stage === "enroute" && (
        <>
          <Card title="En route to pickup" actions={<StatusBadge state="driver_en_route" size="sm" />}>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <DriverRow label="Pickup" value="Mapeera House, Kampala Rd" />
              <DriverRow label="Distance" value="1.2 km" mono />
              <Button variant="secondary" fullWidth iconLeft="navigation">Open navigation</Button>
            </div>
          </Card>
          <Button size="lg" fullWidth onClick={() => setStage("arrived")} style={{ marginTop: "auto" }}>I have arrived</Button>
        </>
      )}

      {stage === "arrived" && (
        <>
          <Card title="At pickup" actions={<StatusBadge state="driver_arrived" size="sm" />}>
            <p style={{ font: "var(--type-body-dense)", color: "var(--text-secondary)" }}>
              Waiting time starts counting after 5 minutes and is billed per the rate card. Mark a no-show only after the configured wait.
            </p>
          </Card>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginTop: "auto" }}>
            <Button size="lg" fullWidth onClick={() => setStage("start")}>Passenger onboard</Button>
            <Button size="lg" fullWidth variant="destructive" iconLeft="user-round-x">Report no show</Button>
          </div>
        </>
      )}

      {stage === "start" && (
        <>
          <Card title="Start trip" subtitle="Opening odometer is required">
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              <div style={{ height: 150, borderRadius: "var(--radius-md)", background: "var(--kr-gray-100)", border: "1px dashed var(--border-strong)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, color: "var(--text-secondary)" }}>
                <Icon name="camera" size={22} />
                <span style={{ font: "var(--type-caption)" }}>Photograph the dashboard</span>
                <Button size="sm" variant="secondary">Take photo</Button>
              </div>
              <FormField label="Opening odometer" required hint="Enter the reading exactly as shown">
                <Input mono size="lg" suffix="km" placeholder="000000" value={odo} onChange={(e) => setOdo(e.target.value)} />
              </FormField>
            </div>
          </Card>
          <Button size="lg" fullWidth iconLeft="play" onClick={() => setStage("running")} style={{ marginTop: "auto" }}>Start trip</Button>
        </>
      )}

      {stage === "running" && (
        <>
          <Card title="Trip in progress" actions={<StatusBadge state="trip_started" size="sm" />}>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <DriverRow label="Started" value="08:14:22" mono />
              <DriverRow label="Opening odometer" value={(odo || "128,940") + " km"} mono />
              <DriverRow label="GPS distance so far" value="22.8 km" mono />
              <DriverRow label="Waiting time" value="12 min" mono />
            </div>
          </Card>
          <Card title="Stops">
            <TripTimeline events={[
              { label: "Trip started", time: "08:14:22" },
              { label: "Waiting", time: "08:51:03", tone: "warning", icon: "pause", detail: "Resumed 09:03:11" },
            ]} />
          </Card>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginTop: "auto" }}>
            <Button size="lg" fullWidth variant="secondary" iconLeft="pause">Start waiting</Button>
            <Button size="lg" fullWidth iconLeft="flag" onClick={() => setStage("complete")}>Complete trip</Button>
          </div>
        </>
      )}

      {stage === "complete" && (
        <>
          <Card title="Complete trip" subtitle="Closing odometer is required">
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              <div style={{ height: 150, borderRadius: "var(--radius-md)", background: "var(--kr-gray-100)", border: "1px dashed var(--border-strong)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, color: "var(--text-secondary)" }}>
                <Icon name="camera" size={22} />
                <span style={{ font: "var(--type-caption)" }}>Photograph the dashboard</span>
                <Button size="sm" variant="secondary">Take photo</Button>
              </div>
              <FormField label="Closing odometer" required>
                <Input mono size="lg" suffix="km" defaultValue="128982" />
              </FormField>
              <Alert tone="warning" title="Check this reading">Odometer distance 42 km differs from GPS distance 38.4 km. A variance is flagged for review.</Alert>
            </div>
          </Card>
          <Button size="lg" fullWidth iconLeft="check" onClick={() => setStage("done")} style={{ marginTop: "auto" }}>Submit and complete</Button>
        </>
      )}

      {stage === "done" && (
        <>
          <Card padding="none">
            <EmptyState icon="circle-check" title="Trip completed" description="TRP-2026-04812 submitted. The record is queued for invoicing and the variance is flagged for the operations team." />
          </Card>
          <Card title="Today">
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <DriverRow label="Trips completed" value="4" mono />
              <DriverRow label="Distance" value="182.6 km" mono />
              <DriverRow label="Waiting time billed" value="38 min" mono />
            </div>
          </Card>
          <Button size="lg" fullWidth variant="secondary" onClick={() => setStage("assigned")} style={{ marginTop: "auto" }}>Next trip</Button>
        </>
      )}
    </PhoneChrome>
  );
}

Object.assign(window, { DriverFlow, PhoneChrome });
