import { useState } from 'react'
import { Button } from '../../../components/core/Button'
import { Alert } from '../../../components/feedback/Alert'
import { Input } from '../../../components/forms/Input'
import { Select } from '../../../components/forms/Select'
import { Switch } from '../../../components/forms/Switch'
import { apiClient } from '../../../lib/apiClient'
import { apiError } from '../../../lib/apiError'
import { MailDnsPanel } from './MailDnsPanel'
import { Note, Row, SecretRow, SectionForm } from '../kit'
import { orNull, useSectionState, withSecrets } from '../state'
import type { SectionProps } from '../types'

export function MailSection({ settings, onSaved, section }: SectionProps) {
  const mail = settings.mail
  const state = useSectionState({
    enabled: mail.enabled,
    host: mail.host ?? '',
    port: String(mail.port),
    username: mail.username ?? '',
    password: '',
    encryption: mail.encryption as string,
    from_address: mail.from_address ?? '',
    from_name: mail.from_name ?? '',
  })
  const { value, set } = state

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  const sendTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const response = await apiClient.post('/settings/mail/test', {})
      setTestResult({ ok: true, text: response.data.message as string })
    } catch (failure) {
      setTestResult({
        ok: false,
        text: apiError(failure, 'Could not send the test email.').message,
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <>
      <SectionForm
        section={section}
        state={state}
        onSaved={onSaved}
        secretKeys={['password']}
        // In the header rather than beside Save: a test send is worth reaching
        // for when nothing has been edited, and the action bar is about the
        // edits.
        actions={
          <Button
            type="button"
            variant="secondary"
            iconLeft="send"
            disabled={testing}
            onClick={() => void sendTest()}
          >
            {testing ? 'Sending…' : 'Send test email'}
          </Button>
        }
        payload={() =>
          withSecrets(
            {
              enabled: value.enabled,
              host: orNull(value.host),
              port: Number(value.port),
              username: orNull(value.username),
              encryption: value.encryption,
              from_address: orNull(value.from_address),
              from_name: orNull(value.from_name),
            },
            { password: value.password },
          )
        }
      >
        {(errors) => (
          <>
            {testResult !== null && (
              <Note>
                <Alert
                  tone={testResult.ok ? 'success' : 'error'}
                  title={testResult.ok ? 'Test email' : 'Test failed'}
                  onDismiss={() => setTestResult(null)}
                >
                  {testResult.text}
                </Alert>
              </Note>
            )}

            <Row
              label="Send email through this server"
              htmlFor="settings-mail-enabled"
              hint="Off writes email to the log instead of sending."
            >
              <Switch
                id="settings-mail-enabled"
                checked={value.enabled}
                onChange={(event) => set('enabled', event.target.checked)}
              />
            </Row>

            <Row label="SMTP host" htmlFor="settings-mail-host" error={errors.host} control={480}>
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                <Input
                  id="settings-mail-host"
                  placeholder="smtp.your-provider.com"
                  value={value.host}
                  onChange={(event) => set('host', event.target.value)}
                  style={{ flex: 1, minWidth: 0 }}
                />
                {/* The port shares the host's row — they are read and typed as
                  one address — so it needs its own name, clipped, or it
                  reaches a screen reader as an unlabelled number box. */}
                <label htmlFor="settings-mail-port" className="kr-sr-only">
                  Port
                </label>
                <Input
                  id="settings-mail-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={value.port}
                  onChange={(event) => set('port', event.target.value)}
                  required
                  style={{ width: 96, flex: '0 0 auto' }}
                />
              </div>
            </Row>

            <Row
              label="Username"
              htmlFor="settings-mail-username"
              error={errors.username}
              control={380}
            >
              <Input
                id="settings-mail-username"
                autoComplete="off"
                value={value.username}
                onChange={(event) => set('username', event.target.value)}
              />
            </Row>

            <SecretRow
              label="Password"
              htmlFor="settings-mail-password"
              secret={mail.password}
              value={value.password}
              onChange={(next) => set('password', next)}
              error={errors.password}
            />

            <Row
              label="Encryption"
              htmlFor="settings-mail-encryption"
              error={errors.encryption}
              required
              control={320}
            >
              <Select
                id="settings-mail-encryption"
                value={value.encryption}
                onChange={(event) => set('encryption', event.target.value)}
                options={[
                  { value: 'tls', label: 'TLS (standard)' },
                  { value: 'none', label: 'None — local relay only' },
                ]}
              />
            </Row>

            <Row
              label="From address"
              htmlFor="settings-mail-from"
              error={errors.from_address}
              control={380}
            >
              <Input
                id="settings-mail-from"
                type="email"
                iconLeft="mail"
                placeholder="noreply@kangaruride.com"
                value={value.from_address}
                onChange={(event) => set('from_address', event.target.value)}
              />
            </Row>

            <Row
              label="From name"
              htmlFor="settings-mail-from-name"
              error={errors.from_name}
              control={380}
            >
              <Input
                id="settings-mail-from-name"
                value={value.from_name}
                onChange={(event) => set('from_name', event.target.value)}
              />
            </Row>
          </>
        )}
      </SectionForm>

      {/*
      Below the form rather than inside it. `SectionForm` is one save of one
      settings group, and DNS is not a setting this platform stores — it is a
      read of the world outside, plus the one record we can compose from the
      From address above.

      Putting it here means the two halves of "make email work" are on one
      screen: the credentials, then what the domain has to say about them.
    */}
      <div style={{ marginTop: 'var(--space-6)' }}>
        <MailDnsPanel />
      </div>
    </>
  )
}
