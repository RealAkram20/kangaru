import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '../../lib/apiClient'
import { apiError } from '../../lib/apiError'
import { formatTimestamp } from '../../lib/format'
import type { ApiSuccess } from '../../types/api'
import { Badge } from '../../components/core/Badge'
import { Button } from '../../components/core/Button'
import { Card } from '../../components/core/Card'
import { Alert } from '../../components/feedback/Alert'
import { Dialog } from '../../components/feedback/Dialog'
import { EmptyState } from '../../components/feedback/EmptyState'

/**
 * Which fleets serve this client, and which have asked to (ADR-0060 §5).
 *
 * **This is the safety catch in the whole onboarding flow.** A second fleet
 * that finds a client already on Kangaru may only ask; without the client
 * answering here, any fleet knowing a registration number could attach itself
 * to another fleet's client and begin reading their bookings.
 *
 * It is also the only surface anywhere on which a `requested` contract is
 * visible — to the party being asked, and to nobody else. A fleet reading this
 * would learn which of its competitors had asked to serve the same client.
 *
 * The requesting fleet is named. That disclosure is one-directional and it is
 * the point: a client cannot answer a request from somebody anonymous, and the
 * asking fleet learns nothing in return until the answer comes.
 */
interface Contract {
  id: number
  status: 'requested' | 'active' | 'ended'
  started_on: string | null
  ended_on: string | null
  fleet?: { id: number; name: string }
}

const TONE: Record<Contract['status'], 'success' | 'info' | 'neutral'> = {
  active: 'success',
  requested: 'info',
  ended: 'neutral',
}

const LABEL: Record<Contract['status'], string> = {
  active: 'Serving you',
  requested: 'Asked to serve you',
  ended: 'No longer serving you',
}

export function OurFleets() {
  const [contracts, setContracts] = useState<Contract[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [ending, setEnding] = useState<Contract | null>(null)

  const load = useCallback(
    () =>
      apiClient
        .get<ApiSuccess<Contract[]>>('/contracts')
        .then((response) => {
          setContracts(response.data.data)
          setError(null)
        })
        .catch((caught: unknown) => setError(apiError(caught, 'Could not load your fleets.').message)),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  async function act(contract: Contract, verb: 'approve' | 'end') {
    setBusy(contract.id)
    try {
      if (verb === 'approve') {
        await apiClient.post(`/contracts/${contract.id}/approval`)
      } else {
        await apiClient.delete(`/contracts/${contract.id}`)
      }
      setEnding(null)
      await load()
    } catch (caught) {
      setError(apiError(caught, 'Could not change that contract.').message)
    } finally {
      setBusy(null)
    }
  }

  if (contracts !== null && contracts.length === 0) {
    return (
      <Card title="Our fleets">
        <EmptyState icon="building-2" title="No fleet is serving you yet" />
      </Card>
    )
  }

  return (
    <>
      {error && <Alert tone="error">{error}</Alert>}

      <Card title="Our fleets" padding="none">
        {(contracts ?? []).map((contract) => (
          <div
            key={contract.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-4)',
              flexWrap: 'wrap',
              padding: 'var(--space-4)',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>{contract.fleet?.name ?? '—'}</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                {contract.started_on
                  ? `Since ${formatTimestamp(contract.started_on)}`
                  : contract.status === 'requested'
                    ? 'Waiting on you'
                    : '—'}
              </div>
            </div>

            <span style={{ display: 'inline-flex', gap: 'var(--space-3)', alignItems: 'center' }}>
              {/* Never colour alone (DESIGN.md, WCAG AA): the badge says it. */}
              <Badge tone={TONE[contract.status]}>{LABEL[contract.status]}</Badge>

              {contract.status === 'requested' && (
                <Button size="sm" disabled={busy === contract.id} onClick={() => void act(contract, 'approve')}>
                  {busy === contract.id ? 'Accepting…' : 'Accept'}
                </Button>
              )}

              {contract.status !== 'ended' && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy === contract.id}
                  onClick={() => setEnding(contract)}
                >
                  {contract.status === 'requested' ? 'Decline' : 'End'}
                </Button>
              )}
            </span>
          </div>
        ))}
      </Card>

      {ending && (
        <Dialog
          title={
            ending.status === 'requested'
              ? `Decline ${ending.fleet?.name}?`
              : `End your contract with ${ending.fleet?.name}?`
          }
          tone="destructive"
          onClose={() => setEnding(null)}
          description={
            ending.status === 'requested'
              ? 'They stop waiting on you. They can ask again later.'
              : 'They stop serving you. Your trips and invoices with them stay on your record.'
          }
          footer={
            <>
              <Button variant="secondary" onClick={() => setEnding(null)} disabled={busy !== null}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={busy !== null} onClick={() => void act(ending, 'end')}>
                {ending.status === 'requested' ? 'Decline' : 'End contract'}
              </Button>
            </>
          }
        />
      )}
    </>
  )
}
