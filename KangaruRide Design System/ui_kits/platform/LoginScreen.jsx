Object.assign(window, window.KangaruRideDesignSystem_69b541);

function LoginScreen({ onSignIn }) {
  const [mfa, setMfa] = React.useState(false);
  return (
    <div style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "1.1fr 1fr" }}>
      <div style={{ background: "var(--surface-chrome)", padding: "var(--space-16) var(--space-12)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <Logo variant="horizontal-navy" height={38} basePath="../../assets" />
        <div>
          <h1 style={{ font: "var(--type-page-title)", fontSize: "var(--text-4xl)", color: "var(--text-on-chrome)", maxWidth: 460 }}>
            Every trip recorded. Every invoice reproducible.
          </h1>
          <p style={{ font: "var(--type-body)", color: "var(--text-on-chrome-secondary)", marginTop: "var(--space-4)", maxWidth: 460 }}>
            Transport management for corporate fleets: dispatch, GPS tracking, odometer capture, rate-card billing and enterprise reporting.
          </p>
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-6)", flexWrap: "wrap" }}>
            <Badge tone="brand" icon="shield-check">Tenant-scoped</Badge>
            <Badge tone="brand" icon="file-text">Audit logged</Badge>
            <Badge tone="brand" icon="wifi-off">Offline tolerant</Badge>
          </div>
        </div>
        <p style={{ font: "var(--type-caption)", color: "var(--text-on-chrome-secondary)" }}>Shanitah General Enterprises Ltd · Kampala, Uganda</p>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-12)" }}>
        <div style={{ width: "100%", maxWidth: 360 }}>
          <h2 style={{ font: "var(--type-section-title)", fontSize: "var(--text-2xl)", color: "var(--text-heading)" }}>Sign in</h2>
          <p style={{ font: "var(--type-body-dense)", color: "var(--text-secondary)", marginTop: 6, marginBottom: "var(--space-6)" }}>
            Use your organisation email. Super Admin and Finance require MFA.
          </p>
          {mfa && (
            <Alert tone="info" title="Enter your 6-digit code" style={{ marginBottom: "var(--space-4)" }}>
              Sent to the authenticator app registered to this account.
            </Alert>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            {mfa ? (
              <FormField label="Authentication code" required>
                <Input mono placeholder="000000" size="lg" />
              </FormField>
            ) : (
              <>
                <FormField label="Work email" required>
                  <Input iconLeft="mail" placeholder="you@company.co.ug" size="lg" defaultValue="aisha.nabirye@kangaruride.com" />
                </FormField>
                <FormField label="Password" required>
                  <Input type="password" iconLeft="lock" placeholder="••••••••" size="lg" defaultValue="password" />
                </FormField>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <Checkbox label="Keep me signed in" />
                  <a href="#" style={{ font: "var(--type-caption)" }}>Forgot password?</a>
                </div>
              </>
            )}
            <Button size="lg" fullWidth iconRight="arrow-right" onClick={() => (mfa ? onSignIn() : setMfa(true))}>
              {mfa ? "Verify and continue" : "Sign in"}
            </Button>
            {mfa && (
              <Button variant="ghost" fullWidth onClick={() => setMfa(false)}>Back</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LoginScreen });
