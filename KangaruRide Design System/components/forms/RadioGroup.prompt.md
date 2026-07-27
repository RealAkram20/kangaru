Mutually exclusive choices where all options should stay visible: booking type, dispatch mode, invoice period.

```jsx
<RadioGroup
  defaultValue="immediate"
  options={[
    { value: "immediate", label: "Immediate", description: "Dispatch now" },
    { value: "scheduled", label: "Scheduled", description: "Pick a date and time" },
  ]}
/>
```

Two to five options. Beyond five, use `Select`.
