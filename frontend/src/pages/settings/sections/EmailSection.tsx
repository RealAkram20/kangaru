import { useEffect, useState } from 'react'
import { Card } from '../../../components/core/Card'
import { Alert } from '../../../components/feedback/Alert'
import { Switch } from '../../../components/forms/Switch'
import { apiClient } from '../../../lib/apiClient'
import { fieldFirstMessage } from '../../../lib/apiError'
import { Row } from '../kit'
import type { SectionProps } from '../types'

/**
 * Which emails this platform sends, for a system administrator to decide.
 *
 * ## Why this one does not use SectionForm
 *
 * Every other section is a group in the `settings` table, saved as a batch by
 * `SectionForm`. These are not settings rows: sixty notification types would
 * triple `SettingsService`'s whitelisted catalogue and make it drift from the
 * enum every time a type is added. The list here comes from the enum itself,
 * so a type added tomorrow appears tomorrow with no migration and no catalogue
 * edit.
 *
 * ## Saved on the switch, with no Save button
 *
 * One flip is one call. There is no batch to lose, so a Save button would only
 * add a step and a way to walk away from an unsaved decision. This is also why
 * the write endpoint takes one type at a time: a screen that fails halfway
 * leaves a state somebody can read, where a partially applied batch does not.
 *
 * ## Required emails are shown and locked, never hidden
 *
 * Hiding them would be the shorter list and the worse one. Somebody looking
 * for "why did nobody get the password reset email" needs to find it here and
 * see that it cannot be switched off. A hidden row leaves them hunting for a
 * control that does not exist.
 */

type Toggle = {
  type: string
  label: string
  required: boolean
  enabled: boolean
}

export function EmailSection({ section }: SectionProps) {
  const [rows, setRows] = useState<Toggle[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    apiClient
      .get('/settings/email')
      .then((response) => {
        if (cancelled) return

        /*
          Checked rather than cast.
          
          The first version cast the payload straight to `Toggle[]`, so
          anything that was not an array reached `rows.filter` and threw
          during render. A thrown render here does not degrade this section:
          it takes down the whole settings page, because every section is
          mounted at once and one of them exploding unmounts the lot. That is
          a very bad trade for a list of switches, and it was found by the
          existing SystemSettingsPage test rather than by this one.
        */
        const payload = response.data?.data

        if (!Array.isArray(payload)) {
          setError('The email list came back in a shape this screen does not understand.')
          return
        }

        setRows(payload as Toggle[])
      })
      .catch((failure) => {
        if (!cancelled) setError(fieldFirstMessage(failure, 'Could not load the email list.'))
      })

    return () => {
      cancelled = true
    }
  }, [])

  const optional = rows?.filter((row) => !row.required) ?? []
  const required = rows?.filter((row) => row.required) ?? []

  async function flip(row: Toggle, enabled: boolean) {
    setSaving(row.type)
    setError(null)

    // Moved before the request so the switch answers the click immediately,
    // and put back below if the server refuses. A control that waits on a
    // round trip before it moves reads as broken on a slow connection, which
    // upcountry is the normal one.
    setRows((current) =>
      current?.map((item) => (item.type === row.type ? { ...item, enabled } : item)) ?? null,
    )

    try {
      await apiClient.put('/settings/email', { type: row.type, enabled })
    } catch (failure) {
      setRows((current) =>
        current?.map((item) => (item.type === row.type ? { ...item, enabled: !enabled } : item)) ??
        null,
      )
      /*
        `fieldFirstMessage`, not `apiError(...).message`. The refusal that
        actually happens here is a 422 for a required type, and a 422 carries
        two messages: Laravel's generic "The given data was invalid." on the
        envelope, and the useful sentence in `errors.type`. Showing the former
        turns a considered refusal into what reads as a broken page.
      */
      setError(fieldFirstMessage(failure, 'Could not change that email.'))
    } finally {
      setSaving(null)
    }
  }

  return (
    <Card title={section.title} subtitle={section.description} bodyStyle={{ padding: 0 }}>
      <div className="kr-settings-body">
        {error !== null && (
          <div className="kr-setting-note">
            <Alert tone="error" title={section.title} onDismiss={() => setError(null)}>
              {error}
            </Alert>
          </div>
        )}

        {rows === null && !error && (
          <div className="kr-setting-note">
            <span style={{ font: 'var(--type-body-dense)', color: 'var(--text-secondary)' }}>
              Loading…
            </span>
          </div>
        )}

        {optional.map((row) => (
          <Row key={row.type} label={row.label} htmlFor={`email-${row.type}`} control={64}>
            <Switch
              id={`email-${row.type}`}
              checked={row.enabled}
              disabled={saving === row.type}
              onChange={(event) => void flip(row, event.target.checked)}
            />
          </Row>
        ))}

        {/*
          The locked ones, once, under one sentence.

          The first version repeated "Always sent" on every row, which put the
          same sixteen words on the screen sixteen times: exactly the noise
          screen rules §9 asks to be deleted. Grouping says it once and makes
          the two halves scannable, which is what somebody hunting for a switch
          actually needs.

          Listed rather than hidden. An administrator looking for "why did
          nobody get the password reset email" has to find it here and see that
          it cannot be moved; a hidden row leaves them hunting for a control
          that does not exist.
        */}
        {required.length > 0 && (
          <>
            <div className="kr-setting-note">
              <h3
                style={{
                  font: 'var(--type-section-title)',
                  fontSize: 'var(--text-base)',
                  color: 'var(--text-heading)',
                  margin: 0,
                }}
              >
                Always sent
              </h3>
              <p
                style={{
                  font: 'var(--type-body-dense)',
                  color: 'var(--text-secondary)',
                  margin: '4px 0 0',
                }}
              >
                Each of these is somebody’s only warning that something changed about their account,
                or the only notice of money owed.
              </p>
            </div>
            {required.map((row) => (
              <Row key={row.type} label={row.label} htmlFor={`email-${row.type}`} control={64}>
                <Switch id={`email-${row.type}`} checked disabled />
              </Row>
            ))}
          </>
        )}
      </div>
    </Card>
  )
}
