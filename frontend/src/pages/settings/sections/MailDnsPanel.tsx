import { useEffect, useState } from 'react'
import { Badge } from '../../../components/core/Badge'
import { Card } from '../../../components/core/Card'
import { IconButton } from '../../../components/core/IconButton'
import { Alert } from '../../../components/feedback/Alert'
import { apiClient } from '../../../lib/apiClient'
import { fieldFirstMessage } from '../../../lib/apiError'
import { Row } from '../kit'

/**
 * The DNS side of email: what is there, and the one record we can hand over.
 *
 * ## Why this is a screen and not a document
 *
 * It was a document first. The owner's objection was the right one: a record
 * you have to go and find in a repo is a record you ask somebody about, and
 * changing the email provider is rare enough that nobody will remember where
 * the file was. This is the screen you are already on when you configure SMTP.
 *
 * ## One record offered, two only checked
 *
 * Screen rules §1: never invent a value.
 *
 * DMARC is the one this platform can compose, because the name is always
 * `_dmarc` and the only variable is the reporting address, which is the
 * from-address on this very form. So it is offered whole, with a copy button.
 *
 * SPF and DKIM are the provider's. Titan's `include:` is not Gmail's and a
 * DKIM selector is whatever the provider generated, so the screen reports
 * whether they exist and refuses to guess their contents. A panel that printed
 * a plausible SPF line for an unknown provider would look authoritative and
 * would break mail for the domain that pasted it.
 */

type Record = {
  domain: string | null
  from_address: string | null
  spf: { status: string; value: string | null }
  dkim: { status: string; selector: string | null }
  dmarc: { status: string; value: string | null; name: string; suggested: string }
}

/**
 * Whether this really is the DNS payload, by the keys this panel reads.
 *
 * A type guard rather than a cast, because a cast is a promise the compiler
 * believes and the runtime does not.
 */
function isRecord(payload: unknown): payload is Record {
  if (payload === null || typeof payload !== 'object') return false

  const candidate = payload as Partial<Record>

  return (
    typeof candidate.spf === 'object' &&
    candidate.spf !== null &&
    typeof candidate.dkim === 'object' &&
    candidate.dkim !== null &&
    typeof candidate.dmarc === 'object' &&
    candidate.dmarc !== null
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'found') return <Badge tone="success">Found</Badge>
  if (status === 'missing') return <Badge tone="warning">Missing</Badge>

  // "Unknown" is a real answer here and not a failure to load. DKIM can only
  // be looked up by a selector we have to guess, so not finding one is not the
  // same statement as there not being one.
  return <Badge tone="neutral">Not detected</Badge>
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    void navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true)
        // Long enough to read, short enough that the button is ready again
        // before somebody wants the next field. Both records get pasted in one
        // sitting.
        setTimeout(() => setCopied(false), 1600)
      },
      () => setCopied(false),
    )
  }

  return (
    <IconButton
      icon={copied ? 'check' : 'copy'}
      label={copied ? `${label} copied` : `Copy ${label}`}
      variant="ghost"
      onClick={copy}
    />
  )
}

/** A value with its copy button, in the monospace DESIGN.md reserves for identifiers. */
function CopyableValue({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
      <code
        style={{
          // `--type-identifier` is the token DESIGN.md §5 reserves for
          // reference codes — plates, invoice numbers — in JetBrains Mono. A
          // DNS value is exactly that: a string somebody transcribes and must
          // not misread, where l and 1 and O and 0 have to look different.
          font: 'var(--type-identifier)',
          color: 'var(--text-body)',
          background: 'var(--surface-sunken)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-control)',
          padding: '6px 8px',
          // Wraps rather than scrolls: a DMARC value is one line somebody
          // needs to see all of before they trust it enough to paste.
          overflowWrap: 'anywhere',
          flex: 1,
          minWidth: 0,
        }}
      >
        {value}
      </code>
      <CopyButton value={value} label={label} />
    </div>
  )
}

export function MailDnsPanel() {
  const [dns, setDns] = useState<Record | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    apiClient
      .get('/settings/mail/dns')
      .then((response) => {
        if (cancelled) return

        const payload = response.data?.data

        /*
          The keys are checked, not just the type.

          The first version tested `typeof payload === 'object'`, which every
          object passes — including the settings payload this page's own test
          returns for every GET. It sailed through the guard, `dns.spf` was
          undefined, and reading `.status` off it threw during render.

          A thrown render here does not degrade this panel: **every settings
          section is mounted at once, so one of them throwing unmounts the
          lot.** The SMTP form beside it, which is the thing somebody actually
          came for, went with it. Caught by the existing SystemSettingsPage
          test rather than by anything of mine — the second time this exact
          shape has bitten on this screen.
        */
        if (!isRecord(payload)) {
          setError('The DNS check came back in a shape this screen does not understand.')
          return
        }

        setDns(payload)
      })
      .catch((failure) => {
        if (!cancelled) setError(fieldFirstMessage(failure, 'Could not check the DNS records.'))
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (error !== null) {
    return (
      <Card title="Email DNS" bodyStyle={{ padding: 0 }}>
        <div className="kr-settings-body">
          <div className="kr-setting-note">
            <Alert tone="error" title="Email DNS" onDismiss={() => setError(null)}>
              {error}
            </Alert>
          </div>
        </div>
      </Card>
    )
  }

  if (dns === null) {
    return (
      <Card title="Email DNS" bodyStyle={{ padding: 0 }}>
        <div className="kr-settings-body">
          <div className="kr-setting-note">
            <span style={{ font: 'var(--type-body-dense)', color: 'var(--text-secondary)' }}>
              Checking…
            </span>
          </div>
        </div>
      </Card>
    )
  }

  if (dns.domain === null) {
    return (
      <Card title="Email DNS" bodyStyle={{ padding: 0 }}>
        <div className="kr-settings-body">
          <div className="kr-setting-note">
            <span style={{ font: 'var(--type-body-dense)', color: 'var(--text-secondary)' }}>
              Set a From address above and save, then these records appear.
            </span>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card
      title="Email DNS"
      subtitle={`Records for ${dns.domain}. Add them at whoever hosts your DNS.`}
      bodyStyle={{ padding: 0 }}
    >
      <div className="kr-settings-body">
        <Row label="SPF" htmlFor="dns-spf" hint="Comes from your email provider.">
          <StatusBadge status={dns.spf.status} />
        </Row>

        <Row
          label="DKIM"
          htmlFor="dns-dkim"
          hint={
            dns.dkim.selector === null
              ? 'Comes from your email provider. We can only look it up by name, so this may exist under one we did not try.'
              : `Found under ${dns.dkim.selector}.`
          }
        >
          <StatusBadge status={dns.dkim.status} />
        </Row>

        <Row label="DMARC" htmlFor="dns-dmarc">
          <StatusBadge status={dns.dmarc.status} />
        </Row>

        {dns.dmarc.status !== 'found' && (
          <>
            {/*
              The two fields, side by side, exactly as the DNS form asks for
              them. Type is TXT everywhere so it is stated once in the label
              rather than given its own copyable row.
            */}
            <Row label="Add a TXT record named" htmlFor="dns-dmarc-name">
              <CopyableValue value={dns.dmarc.name} label="the name" />
            </Row>
            <Row label="with this value" htmlFor="dns-dmarc-value">
              <CopyableValue value={dns.dmarc.suggested} label="the value" />
            </Row>
            <div className="kr-setting-note">
              <p
                style={{
                  font: 'var(--type-body-dense)',
                  color: 'var(--text-secondary)',
                  margin: 0,
                }}
              >
                {/*
                  The one sentence this panel earns. `p=none` changes nothing
                  about delivery, which is the fact that stops somebody either
                  being afraid to add it or reaching straight for enforcement.
                */}
                This reports only and changes nothing about delivery. Move to a stricter policy once
                the reports show only your own mail.
              </p>
            </div>
          </>
        )}
      </div>
    </Card>
  )
}
