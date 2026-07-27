A pill label for counts, categories and metadata. For trip/invoice lifecycle states use `StatusBadge` instead — it owns the state→colour map.

```jsx
<Badge tone="brand" icon="shield-check">Verified</Badge>
<Badge tone="warning" icon="triangle-alert">Variance 4.2 km</Badge>
```

Always pair a tone with text (and usually an icon): colour alone is not a status.
