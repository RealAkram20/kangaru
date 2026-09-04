import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { apiClient } from '../lib/apiClient'
import { apiError } from '../lib/apiError'
import { formatRelativeTime } from '../lib/format'
import type { ApiSuccess } from '../types/api'
import { Badge } from '../components/core/Badge'
import { Button } from '../components/core/Button'
import { Card } from '../components/core/Card'
import { Alert } from '../components/feedback/Alert'
import { Dialog } from '../components/feedback/Dialog'
import { EmptyState } from '../components/feedback/EmptyState'
import { FormField } from '../components/forms/FormField'
import { Input } from '../components/forms/Input'
import { PageFill } from '../components/layout/PageFill'

/**
 * What is waiting on me — a driver's contract with Kangaru (ADR-0055 §5).
 *
 * One screen, two queues, because it is one question asked by different
 * parties: a **fleet** sees its own drivers waiting on its consent; **head
 * office** sees everything already consented and waiting on them. The server
 * decides which list arrives, so this page never asks for somebody else's.
 *
 * The verb changes with the level and that is deliberate — a fleet *consents*,
 * head office *accepts*. They are different decisions and calling both
 * "approve" would hide that the fleet's answer is about its own employee and
 * head office's is about its own economy.
 */
interface WalkInContract {
  id: number
  status: 'requested' | 'awaiting_kangaru' | 'active' | 'refused'
  fleet_answered_at: string | null
  kangaru_answered_at: string | null
  refused_reason: string | null
  driver: { id: number | null; name: string | null; owns_vehicle: boolean }
  fleet: { id: number; name: string } | null
}

export function DriverContractsPage() {
  const { user } = useAuth()
  const isHeadOffice = user?.access_level === 'kangaru'

  const [contracts, setContracts] = useState<WalkInContract[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [refusing, setRefusing] = useState<WalkInContract | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(
    () =>
      apiClient
        .get<ApiSuccess<WalkInContract[]>>('/walk-in-contracts')
        .then((response) => {
          setContracts(response.data.data)
          setError(null)
        })
        .catch((caught: unknown) => setError(apiError(caught, 'Could not load the requests.').message)),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  async function act(contract: WalkInContract, verb: 'consent' | 'approval' | 'refusal') {
    setBusy(contract.id)
    try {
      await apiClient.post(
        `/walk-in-contracts/${contract.id}/${verb}`,
        verb === 'refusal' ? { reason: reason.trim() || null } : {},
      )
      setRefusing(null)
      setReason('')
      await load()
    } catch (caught) {
      setError(apiError(caught, 'Could not answer that request.').message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <PageFill>
      <PageFill.Flex>
        {error && <Alert tone="error">{error}</Alert>}

        <Card
          fill
          padding="none"
          title="Driver contracts"
          subtitle={
            isHeadOffice ? 'Consented, waiting on Kangaru' : 'Your drivers asking to take walk-in work'
          }
        >
          {contracts !== null && contracts.length === 0 ? (
            <EmptyState
              icon="inbox"
              title="Nothing waiting on you"
              description={
                isHeadOffice
                  ? 'Requests appear here once a driver’s fleet has consented.'
                  : 'Requests appear here when one of your drivers asks.'
              }
            />
          ) : (
            (contracts ?? []).map((contract) => (
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
                  <div style={{ fontWeight: 500 }}>{contract.driver.name ?? '—'}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                    {/*
                      A driver-partner has no fleet to ask (ADR-0048 §7), so
                      "no fleet" here is the waiver rather than missing data.
                      Saying which it is stops the office reading a correct row
                      as a broken one.
                    */}
                    {contract.driver.owns_vehicle
                      ? 'Owns their vehicle — no fleet to ask'
                      : (contract.fleet?.name ?? '—')}
                    {contract.fleet_answered_at && isHeadOffice
                      ? ` · consented ${formatRelativeTime(contract.fleet_answered_at)}`
                      : ''}
                  </div>
                </div>

                <span style={{ display: 'inline-flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                  <Badge tone={contract.status === 'requested' ? 'info' : 'warning'}>
                    {contract.status === 'requested' ? 'Waiting on you' : 'Waiting on Kangaru'}
                  </Badge>

                  <Button
                    size="sm"
                    disabled={busy === contract.id}
                    onClick={() => void act(contract, isHeadOffice ? 'approval' : 'consent')}
                  >
                    {busy === contract.id ? 'Saving…' : isHeadOffice ? 'Accept' : 'Consent'}
                  </Button>

                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === contract.id}
                    onClick={() => setRefusing(contract)}
                  >
                    Refuse
                  </Button>
                </span>
              </div>
            ))
          )}
        </Card>
      </PageFill.Flex>

      {refusing && (
        <Dialog
          title={`Refuse ${refusing.driver.name}?`}
          tone="destructive"
          onClose={() => {
            setRefusing(null)
            setReason('')
          }}
          footer={
            <>
              <Button
                variant="secondary"
                disabled={busy !== null}
                onClick={() => {
                  setRefusing(null)
                  setReason('')
                }}
              >
                Cancel
              </Button>
              <Button variant="destructive" disabled={busy !== null} onClick={() => void act(refusing, 'refusal')}>
                Refuse
              </Button>
            </>
          }
        >
          <FormField
            label="Reason"
            htmlFor="wc-reason"
            hint="Optional, and shown to the driver. They are told the outcome either way."
          >
            <Input id="wc-reason" value={reason} onChange={(event) => setReason(event.target.value)} autoFocus />
          </FormField>
        </Dialog>
      )}
    </PageFill>
  )
}
