An inline banner for conditions the operator must know about: flagged odometer variance, offline sync pending, Mapbox degradation, credit limit reached.

```jsx
<Alert tone="warning" title="Odometer variance flagged" action={<Button variant="secondary" size="sm">Review</Button>}>
  GPS recorded 38.4 km; odometer recorded 42.6 km. Review within 2 business days.
</Alert>
```

Alerts sit at the top of the affected card or page, never float. Say what happened and what to do next.
