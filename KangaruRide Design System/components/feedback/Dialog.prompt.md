A centred modal over a navy scrim, for assignment, confirmation and any irreversible finance action.

```jsx
<Dialog tone="destructive" title="Cancel this trip?"
  description="A cancellation charge applies per the tenant's rate card. This is recorded in the audit log."
  footer={<><Button variant="secondary" onClick={close}>Keep trip</Button><Button variant="destructive">Cancel trip</Button></>}>
  <FormField label="Reason" required><Select options={["Passenger no longer needs it","Vehicle unavailable"]} /></FormField>
</Dialog>
```

State the consequence in `description`, not in the button. 520px default; 640px when it holds a form.
