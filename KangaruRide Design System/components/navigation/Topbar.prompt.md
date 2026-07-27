The 64px navy application bar: page title, tenant switcher, global search, notifications, signed-in user.

```jsx
<Topbar title="Dispatch board" tenant="Centenary Bank" onSearch={q => …}
  user={{ name: "Aisha N.", role: "Dispatcher" }} />
```

The tenant chip is not decorative — operators work across tenants and mis-scoped actions are the platform's highest-severity risk. Keep it on every screen.
