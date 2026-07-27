Renders the append-only `trip_events` record as a vertical timeline — the evidence view behind every trip and every billing dispute.

```jsx
<TripTimeline events={[
  { label: "Trip started", time: "08:14:22", detail: "Opening odometer 128,940 km", meta: <Badge tone="brand" icon="camera">Dashboard photo</Badge> },
  { label: "Waiting", time: "08:51:03", tone: "warning", icon: "pause", detail: "12 min billed per rate card" },
  { label: "Trip completed", time: "09:32:40", detail: "Closing odometer 128,978 km" },
  { label: "Invoice generated", done: false },
]} />
```

Timestamps are mono. Never reorder or edit events — the timeline mirrors an immutable log.
