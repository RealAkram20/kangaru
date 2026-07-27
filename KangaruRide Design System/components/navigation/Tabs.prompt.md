Switches between sibling views without leaving the page. Underline tabs carry a 2px green indicator; pill tabs sit in a sunken tray inside a card.

```jsx
<Tabs tabs={[{value:"all",label:"All trips",count:184},{value:"live",label:"Live",count:12}]} />
<Tabs variant="pill" tabs={["Route","History","Events"]} />
```

Never more than 6 tabs. Counts are optional but expected on operational queues.
