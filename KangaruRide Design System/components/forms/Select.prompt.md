Native select styled to match `Input` — used for vehicle category, zone, cost centre, rate card version and every filter bar.

```jsx
<Select placeholder="All vehicle categories" options={["Saloon", "SUV", "Van", "Truck"]} />
```

Native on purpose: dispatchers keyboard-drive these screens all day. For multi-select filters, use several Selects rather than a custom popover.
