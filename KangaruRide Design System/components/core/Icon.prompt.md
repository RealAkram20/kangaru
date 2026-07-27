Renders a Lucide glyph inheriting `currentColor` — the only sanctioned way to draw an icon in KangaruRide UI.

```jsx
<Icon name="map-pin" size={16} />
<Icon name="truck" size={24} title="Fleet" />
```

Requires the Lucide UMD build on the page: `<script src="https://unpkg.com/lucide@0.475.0/dist/umd/lucide.js"></script>`. Without it the component renders a neutral placeholder box rather than throwing. Never hand-roll an SVG or use an emoji in its place.
