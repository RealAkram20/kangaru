The platform's primary navigation: 248px navy rail, grouped items, green 3px active indicator plus an elevated navy row.

```jsx
<SidebarNav
  active="dispatch"
  basePath="../../assets"
  sections={[
    { items: [{ id: "dashboard", label: "Dashboard", icon: "layout-dashboard" }] },
    { label: "Operations", items: [{ id: "dispatch", label: "Dispatch", icon: "route", badge: 6 }] },
  ]}
/>
```

Dark chrome, light content — the sidebar is always navy, never white. Collapse to `collapsed` on narrow viewports; labels then move into `title` tooltips.
