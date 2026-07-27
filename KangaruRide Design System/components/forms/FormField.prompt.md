The label + hint + error wrapper every form control sits inside; keeps 6px label-to-control spacing consistent across the platform.

```jsx
<FormField label="Pickup location" required hint="Search or drop a pin">
  <Input iconLeft="map-pin" placeholder="e.g. Centenary Bank, Mapeera House" />
</FormField>
```

Errors replace hints, never stack with them.
