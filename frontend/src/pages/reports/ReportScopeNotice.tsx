import { Icon } from '../../components/core/Icon'

/**
 * Whose figures the report on screen holds (ADR-0007 rule 5).
 *
 * The rule is that a report "must say so on screen and in the exported file
 * header". The exported header was done first because that is the document
 * that travels; this is the screen half, and it exists because the client
 * picker only communicates scope *implicitly*. A reader who arrives at a
 * page somebody else left open, or who reads the unfiltered trip report,
 * has no other way to tell whether a total is one client's or everyone's.
 *
 * Renders the same string the XLSX and PDF headers carry — `meta.covers`,
 * built from one place on the server — so the screen and the file cannot
 * describe the same figures differently.
 *
 * Silent for a client's own user reading their own report, where naming
 * their own company on every panel is noise rather than information. It
 * speaks up exactly when the answer is not obvious: a platform reader, and
 * most of all an unfiltered one.
 */
export function ReportScopeNotice({
  covers,
  scope,
}: {
  /** `meta.covers` — "All clients", or the client's name. */
  covers: string | undefined
  scope: 'platform' | 'tenant' | undefined
}) {
  if (scope !== 'platform' || !covers) return null

  const spansEveryone = covers === 'All clients'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--gap-inline)',
        fontSize: 'var(--text-sm)',
        // One colour for both, with the icon and the wording carrying the
        // difference. Reaching for a warning token here would mean
        // depending on a variable this component cannot see the definition
        // of, and a spanning report is not a warning — it is a fact that
        // has to be legible.
        color: 'var(--text-secondary)',
      }}
    >
      <Icon name={spansEveryone ? 'users' : 'building-2'} size={14} />
      <span>
        {spansEveryone ? (
          <>
            Figures cover <strong>every client</strong>, totalled. Choose a client to see one
            client&rsquo;s own.
          </>
        ) : (
          <>
            Figures cover <strong>{covers}</strong> only.
          </>
        )}
      </span>
    </div>
  )
}
