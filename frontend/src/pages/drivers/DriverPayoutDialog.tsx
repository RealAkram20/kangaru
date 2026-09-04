import { useCallback, useEffect, useState } from 'react'

import { Dialog } from '../../components/feedback/Dialog'
import { apiClient } from '../../lib/apiClient'
import { apiError } from '../../lib/apiError'
import type { Driver } from '../../types/driver'

/**
 * Where a driver's money is sent, as the office needs it (ADR-0042 §4).
 *
 * **This exists because the loop is not closed without it.** The completeness
 * census found four features whose backend nobody in the office could reach,
 * and a payout destination a clerk cannot read is a form the driver filled in
 * for nobody.
 *
 * **It shows the whole account number**, which is the point — a clerk cannot
 * wire money to a mask. The driver's own app never sees it. That asymmetry is
 * deliberate and is why the API has two resources rather than one with a flag.
 *
 * **Read-only.** The office does not edit a driver's payout details: the
 * driver owns them, changing them for somebody is how money quietly goes to
 * the wrong place, and the audit trail should say the driver did it. If the
 * details are wrong, the fix is a phone call and the driver changes them.
 *
 * The endpoint is gated on `drivers.manage` — not `drivers.view`, which every
 * dispatcher holds — so a 403 here is the policy working, not a bug.
 */
type PayoutAccount = {
  kind: 'bank' | 'mobile_money'
  kind_label: string
  institution: string
  account_holder: string
  account_number: string
  updated_at: string | null
}

type Envelope = { data: { payout_account: PayoutAccount } }

export function DriverPayoutDialog({ driver, onClose }: { driver: Driver; onClose: () => void }) {
  const [account, setAccount] = useState<PayoutAccount | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(
    () =>
      apiClient
        .get<Envelope>(`/drivers/${driver.id}/payout-account`)
        .then((response) => {
          setAccount(response.data.data.payout_account)
          setMessage(null)
        })
        .catch((failure) =>
          // The server distinguishes "this driver has given no details" from
          // "no such driver", and the office needs that difference: the first
          // is a phone call, the second is a bug.
          setMessage(
            apiError(failure, 'Could not load this driver’s payout details.').message,
          ),
        )
        .finally(() => setLoading(false)),
    [driver.id],
  )

  // `.then()` rather than `await` in an async effect body, for the reason
  // `DriverDocumentsDialog` records: the lint reads a synchronous call to a
  // state setter as a set during render, and the promise chain defers it.
  useEffect(() => {
    void load()
  }, [load])

  return (
    <Dialog title={`Payout details — ${driver.name}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {loading && <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>}

        {message !== null && !loading && (
          <p style={{ color: 'var(--text-secondary)' }}>{message}</p>
        )}

        {account !== null && (
          <>
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: 'var(--space-2) var(--space-4)',
                margin: 0,
              }}
            >
              <Row label={account.kind_label} value={account.institution} />
              <Row label="Name on the account" value={account.account_holder} />
              {/*
                Monospaced and selectable. A clerk is copying this into a bank
                portal, and a proportional font makes 1 and l and 0 and O the
                same shape — which is exactly the mistake that sends somebody's
                pay to a stranger.
              */}
              <Row label="Account number" value={account.account_number} mono />
            </dl>

            <p style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)', margin: 0 }}>
              The driver keeps these details up to date from their app. The office does not edit
              them — if they are wrong, ask the driver to change them, so the audit trail says
              who did.
            </p>
          </>
        )}
      </div>
    </Dialog>
  )
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)' }}>{label}</dt>
      <dd
        style={{
          margin: 0,
          font: mono ? 'var(--type-identifier)' : 'var(--type-body)',
          color: 'var(--text-heading)',
          userSelect: 'text',
        }}
      >
        {value}
      </dd>
    </>
  )
}
