import { Alert } from '../feedback/Alert'

/**
 * The ten codes, shown the only time they are ever legible (ADR-0008).
 *
 * Shared by enrolment and by Settings' regenerate action, because the
 * warning is the substance here and two copies of a warning are two
 * warnings that can drift. AGENTS.md: a component appearing more than once
 * becomes a reusable one.
 *
 * The copy is deliberately blunt about there being no second chance. These
 * are stored hashed, so no endpoint and no support process can produce them
 * again — and because no administrator can reset another user's factor
 * (the same rule that forbids resetting another user's password), a
 * privileged account with a lost phone and no printed code is unrecoverable.
 * A softer message would be a kinder lie.
 */
export function RecoveryCodeList({ codes }: { codes: string[] }) {
  return (
    <>
      <Alert tone="warning" title="These are shown once">
        They are stored hashed, so nobody — including support — can show them to you again. If you
        lose your authenticator and have no code left, no administrator can restore this account.
      </Alert>

      <ul
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 'var(--space-2)',
          margin: 'var(--space-4) 0',
          padding: 0,
          listStyle: 'none',
          fontFamily: 'var(--font-mono, monospace)',
        }}
      >
        {codes.map((code) => (
          <li
            key={code}
            style={{ padding: 'var(--space-2)', background: 'var(--surface-sunken, transparent)' }}
          >
            {code}
          </li>
        ))}
      </ul>

      <p style={{ font: 'var(--type-body-dense)', color: 'var(--text-secondary)' }}>
        Each code works once. Print them or put them somewhere physical — a drawer beats a
        screenshot on the phone you might lose.
      </p>
    </>
  )
}
