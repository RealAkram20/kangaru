A dashboard metric tile — the one place Sora is used at large sizes inside the app.

```jsx
<KPIStat label="Trips today" value="184" delta="+12%" hint="vs last Tuesday" icon="route" />
<KPIStat label="Outstanding" value="41.2M" unit="UGX" deltaDirection="down" delta="-6%" />
```

Four across on desktop. Pre-format values; the component does not localise. Deltas are optional — omit rather than invent a comparison.
