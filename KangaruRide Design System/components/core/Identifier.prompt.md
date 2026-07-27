Wraps any machine-readable value in JetBrains Mono so auditors can spot it inside prose — vehicle plates, trip IDs, invoice numbers, odometer readings, reference codes (DESIGN.md §6).

```jsx
<Identifier kind="plate">UBK 421J</Identifier>
<Identifier kind="chip">TRP-2026-04812</Identifier>
<Identifier>128,940 km</Identifier>
```

Never use it for prose or column headers. Numeric columns stay in Inter with `.kr-tabular`; only the identifier cell goes mono.
