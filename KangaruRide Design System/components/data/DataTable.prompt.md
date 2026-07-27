The workhorse of the platform: trips, vehicles, drivers, invoices, audit log. Always on a light surface — never dense data on navy.

```jsx
<Card padding="none">
  <DataTable dense columns={[
    { key: "trip", header: "Trip ID", render: r => <Identifier kind="chip">{r.trip}</Identifier> },
    { key: "plate", header: "Vehicle", render: r => <Identifier kind="plate">{r.plate}</Identifier> },
    { key: "distance", header: "Distance", numeric: true, sortable: true },
    { key: "state", header: "Status", render: r => <StatusBadge state={r.state} /> },
  ]} rows={rows} onRowClick={openTrip} />
</Card>
```

Uppercase 12px column headers on `--surface-sunken`; 1px row rules; hover tints the row. Money and distance columns are `numeric` so they align.
