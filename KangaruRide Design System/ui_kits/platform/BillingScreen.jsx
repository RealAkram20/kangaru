Object.assign(window, window.KangaruRideDesignSystem_69b541);

const INVOICES = [
  { id: 1, no: "INV-2026-0417", company: "Centenary Bank", period: "Jun 2026", trips: 3128, amount: "41,208,500", due: "2026-08-01", state: "invoice_generated" },
  { id: 2, no: "INV-2026-0416", company: "Centenary Bank", period: "May 2026", trips: 2984, amount: "38,914,000", due: "2026-07-01", state: "paid" },
  { id: 3, no: "INV-2026-0415", company: "Uganda Red Cross", period: "Jun 2026", trips: 412, amount: "6,105,000", due: "2026-07-15", state: "overdue" },
  { id: 4, no: "INV-2026-0414", company: "Ministry of Works", period: "Jun 2026", trips: 288, amount: "4,882,400", due: "2026-08-01", state: "disputed" },
  { id: 5, no: "INV-2026-0413", company: "Aga Khan Foundation", period: "Jun 2026", trips: 96, amount: "1,740,000", due: "2026-07-20", state: "paid" },
];

function BillingScreen() {
  const [creditNote, setCreditNote] = React.useState(false);
  const cols = [
    { key: "no", header: "Invoice no.", render: (r) => <Identifier kind="chip">{r.no}</Identifier> },
    { key: "company", header: "Company", sortable: true },
    { key: "period", header: "Period" },
    { key: "trips", header: "Trips", numeric: true, sortable: true },
    { key: "amount", header: "Amount (UGX)", numeric: true, sortable: true },
    { key: "due", header: "Due", numeric: true, render: (r) => <Identifier size="xs" tone="muted">{r.due}</Identifier> },
    { key: "state", header: "Status", render: (r) => <StatusBadge state={r.state} size="sm" /> },
    { key: "act", header: "", width: 88, render: (r) => (
      <span style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
        <IconButton icon="download" label="Download PDF" size="sm" />
        <IconButton icon="ellipsis-vertical" label="More" size="sm" onClick={() => setCreditNote(true)} />
      </span>
    ) },
  ];
  return (
    <div>
      <PageHead
        title="Invoices"
        sub="Monthly billing · amounts stored as integer UGX · every invoice reproducible from stored inputs"
        actions={
          <>
            <Button variant="secondary" iconLeft="table-2">Rate cards</Button>
            <Button variant="secondary" iconLeft="download">Export Excel</Button>
            <Button iconLeft="file-plus">Generate invoices</Button>
          </>
        }
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "var(--space-4)", marginBottom: "var(--space-6)" }}>
        <KPIStat label="Invoiced this month" value="52.9M" unit="UGX" icon="receipt" />
        <KPIStat label="Outstanding" value="10.9M" unit="UGX" delta="-6%" deltaDirection="down" icon="clock" />
        <KPIStat label="Disputed" value="1" hint="0.8% of invoices" icon="triangle-alert" />
        <KPIStat tone="accent" label="Days to month close" value="10" icon="calendar-clock" />
      </div>
      <Alert tone="info" title="Rate card v4 is in use and locked" style={{ marginBottom: "var(--space-4)" }}>
        Rate cards are versioned and immutable once used. Historical invoices always reference their exact version.
      </Alert>
      <FilterBar>
        <Input size="sm" iconLeft="search" placeholder="Invoice no. or company" style={{ width: 260 }} />
        <Select size="sm" placeholder="All companies" options={["Centenary Bank", "Uganda Red Cross", "Ministry of Works"]} />
        <Select size="sm" placeholder="All statuses" options={["Generated", "Paid", "Overdue", "Disputed"]} />
        <Select size="sm" defaultValue="jun" options={[{ value: "jun", label: "June 2026" }, { value: "may", label: "May 2026" }]} />
        <Button variant="ghost" size="sm" iconLeft="x">Clear</Button>
      </FilterBar>
      <Card padding="none">
        <DataTable dense selectable columns={cols} rows={INVOICES} />
        <Pagination page={1} pageCount={3} pageSize={25} total={64} />
      </Card>

      <Dialog
        open={creditNote}
        tone="warning"
        title="Issue a credit note"
        description="Issued invoices are never edited. A credit note is appended and the original invoice remains on record."
        onClose={() => setCreditNote(false)}
        width={560}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreditNote(false)}>Cancel</Button>
            <Button onClick={() => setCreditNote(false)}>Issue credit note</Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <FormField label="Amount" required hint="Integer UGX">
            <Input mono suffix="UGX" placeholder="0" />
          </FormField>
          <FormField label="Reason" required>
            <Select placeholder="Select a reason" options={["Disputed distance", "Duplicate trip billed", "Rate applied in error", "Goodwill adjustment"]} />
          </FormField>
        </div>
      </Dialog>
    </div>
  );
}

Object.assign(window, { BillingScreen });
