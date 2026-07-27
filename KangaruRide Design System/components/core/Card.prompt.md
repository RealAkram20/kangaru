The default content container: white surface, 1px `--border-default`, 12px radius, `--shadow-xs`. Cards get borders, not big shadows.

```jsx
<Card title="Active trips" subtitle="Live" actions={<Button variant="secondary" size="sm">View all</Button>}>
  …
</Card>
<Card padding="none"><DataTable … /></Card>
```

Use `padding="none"` whenever a DataTable or map fills the card so the content meets the border.
