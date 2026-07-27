The standard action control; labels are always Inter SemiBold so white-on-green clears the AA large-text threshold (DESIGN.md §3).

```jsx
<Button variant="primary" iconLeft="plus">New booking</Button>
<Button variant="secondary" size="sm">Export CSV</Button>
<Button variant="destructive" iconLeft="x-circle">Cancel trip</Button>
<Button variant="ghost" onChrome iconLeft="bell" />
```

One primary button per view. `secondary` is a bordered transparent button with green-dark text (hover fills with `--kr-green-tint`), not a grey filled button. `ghost` on navy chrome needs `onChrome`.
