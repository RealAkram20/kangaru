The single source of truth for trip and invoice lifecycle state colour — never tint a state by hand.

```jsx
<StatusBadge state="trip_started" />
<StatusBadge state="Waiting" size="sm" />
<StatusBadge state="flagged" label="Variance 4.2 km" />
```

The full state map (`TRIP_STATES`) mirrors the trip lifecycle in PROJECT.md. Every badge carries a label and an icon, satisfying the "never colour alone" rule.
