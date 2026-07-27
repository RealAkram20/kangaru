Renders a supplied KangaruRide lockup from `assets/`. Never redraw, recolour or reconstruct the mark.

```jsx
<Logo variant="horizontal-navy" height={32} basePath="../../assets" />
<Logo variant="mark-solid" height={28} withWordmark />
```

Copy the PNGs out of `assets/` next to your page and set `basePath` accordingly. Clear space around the lockup is at least the height of the circle mark's stroke gap — in practice 8px at 24px tall, 16px at 40px+. The tagline "For Safety and Reliability" is part of the supplied artwork; do not typeset it separately.
