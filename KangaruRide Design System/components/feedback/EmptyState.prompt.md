Fills an empty table, queue or panel with an explanation instead of blank space.

```jsx
<EmptyState icon="route" title="No unassigned bookings"
  description="Every booking for today has a driver and vehicle."
  action={<Button variant="secondary" iconLeft="plus">New booking</Button>} />
```

Distinguish "nothing yet" (offer the creating action) from "nothing matches" (offer to clear filters). Never leave a table body blank.
