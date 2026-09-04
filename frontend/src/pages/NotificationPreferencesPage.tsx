import { useEffect, useState } from 'react'
import { Card } from '../components/core/Card'
import { Alert } from '../components/feedback/Alert'
import { Switch } from '../components/forms/Switch'
import { apiClient } from '../lib/apiClient'
import { fieldFirstMessage } from '../lib/apiError'
import { Row } from './settings/kit'

/**
 * "Choose which emails you get."
 *
 * ## Why this page had to exist
 *
 * **Every email this platform sends carries a footer link here.** Until this
 * page there was nothing at the other end, which is the failure
 * `StoreUserRequest` named when it refused to build half an invite flow: a
 * link to nowhere is worse than no link, because it tells the reader they can
 * stop these emails and then proves they cannot.
 *
 * ## Three things can silence an email and this page owns one
 *
 * A type can be required, so nobody may switch it. A system administrator can
 * switch it off for the whole platform. And a person can switch it off for
 * themselves. This page owns the third and **reports the other two**, because
 * somebody who stopped getting invoices deserves to see it was not their own
 * doing rather than to hunt for a switch that is already off.
 *
 * ## No Save button
 *
 * One flick is one call. There is no batch to lose, so a Save button would add
 * a step and a way to walk away from a decision the reader thinks they made.
 * Same reasoning as the platform menu in Settings.
 */

type Preference = {
  type: string
  label: string
  required: boolean
  available: boolean
  enabled: boolean
}

export function NotificationPreferencesPage() {
  const [rows, setRows] = useState<Preference[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    apiClient
      .get('/me/mail-preferences')
      .then((response) => {
        if (cancelled) return

        const payload = response.data?.data

        // Checked rather than cast. A thrown render here takes the page with
        // it, and this is the page somebody reaches from an email when they
        // are already annoyed by one.
        if (!Array.isArray(payload)) {
          setError('Your preferences came back in a shape this screen does not understand.')
          return
        }

        setRows(payload as Preference[])
      })
      .catch((failure) => {
        if (!cancelled) setError(fieldFirstMessage(failure, 'Could not load your preferences.'))
      })

    return () => {
      cancelled = true
    }
  }, [])

  const choosable = rows?.filter((row) => !row.required && row.available) ?? []
  const fixed = rows?.filter((row) => row.required || !row.available) ?? []

  async function flip(row: Preference, enabled: boolean) {
    setSaving(row.type)
    setError(null)

    // Optimistic, and taken back below if the server refuses. A control that
    // waits on a round trip before it moves reads as broken on the
    // connections PRODUCT.md describes.
    setRows(
      (current) =>
        current?.map((item) => (item.type === row.type ? { ...item, enabled } : item)) ?? null,
    )

    try {
      await apiClient.put('/me/mail-preferences', { type: row.type, enabled })
    } catch (failure) {
      setRows(
        (current) =>
          current?.map((item) =>
            item.type === row.type ? { ...item, enabled: !enabled } : item,
          ) ?? null,
      )
      setError(fieldFirstMessage(failure, 'Could not change that.'))
    } finally {
      setSaving(null)
    }
  }

  return (
    /*
      An ordinary scrolling column, not `PageFill`.

      `PageFill` pins its child to `height: 100%` so the page itself never
      scrolls and an inner region does — right for a data table that should
      fill the viewport, wrong for two stacked cards holding forty rows. The
      first version used it and the second card pushed the first one out of
      reach entirely.
    */
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <Card title="Emails you can turn off" bodyStyle={{ padding: 0 }}>
        <div className="kr-settings-body">
          {error !== null && (
            <div className="kr-setting-note">
              <Alert tone="error" title="Email preferences" onDismiss={() => setError(null)}>
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

          {rows !== null && choosable.length === 0 && !error && (
            /* One line, and the button is the other page. Screen rules §9: an
               empty state is one line and one action, never a paragraph. */
            <div className="kr-setting-note">
              <span style={{ font: 'var(--type-body-dense)', color: 'var(--text-secondary)' }}>
                Every email you get is one nobody can turn off.
              </span>
            </div>
          )}

          {choosable.map((row) => (
            <Row key={row.type} label={row.label} htmlFor={`pref-${row.type}`} control={64}>
              <Switch
                id={`pref-${row.type}`}
                checked={row.enabled}
                disabled={saving === row.type}
                onChange={(event) => void flip(row, event.target.checked)}
              />
            </Row>
          ))}
        </div>
      </Card>

      {fixed.length > 0 && (
        <Card
          title="Emails you always get"
          subtitle="Each of these is your only warning that something changed about your account, or the only notice of money owed."
          bodyStyle={{ padding: 0 }}
        >
          <div className="kr-settings-body">
            {fixed.map((row) => (
              <Row
                key={row.type}
                label={row.label}
                htmlFor={`pref-${row.type}`}
                /* Only the platform-off rows say anything. The required ones
                     are explained once by the card subtitle above, and
                     repeating it on every line is the noise screen rules §9
                     asks to be deleted. */
                hint={row.available ? undefined : 'Your office has turned this off for everybody.'}
                control={64}
              >
                <Switch id={`pref-${row.type}`} checked={row.available} disabled />
              </Row>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
