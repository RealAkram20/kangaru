Single-line text field. Focus draws a green 1px border plus a 3px green glow; error state swaps the border to `--kr-error`.

```jsx
<Input iconLeft="search" placeholder="Search trips, plates, invoices" />
<Input mono suffix="km" type="number" defaultValue="128940" />
```

Wrap in `FormField` for a label. Use `mono` + `suffix` for odometer and distance entry so readings read as data.
