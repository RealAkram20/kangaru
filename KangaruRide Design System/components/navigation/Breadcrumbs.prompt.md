A 12px trail for records nested three or more levels deep — trips inside companies, invoices inside statements.

```jsx
<Breadcrumbs onChrome items={[{label:"Trips"},{label:"TRP-2026-04812"}]} />
```

Two levels or fewer: skip it, the page title is enough.
