import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../../lib/apiClient'
import { apiError, fieldErrors } from '../../lib/apiError'
import type { VehicleCategory } from '../../types/vehicleCategory'
import { Badge } from '../../components/core/Badge'
import { Button } from '../../components/core/Button'
import { DataTable, type DataColumn } from '../../components/data/DataTable'
import { Alert } from '../../components/feedback/Alert'
import { Dialog } from '../../components/feedback/Dialog'
import { FormField } from '../../components/forms/FormField'
import { Input } from '../../components/forms/Input'
import { Textarea } from '../../components/forms/Textarea'
import './vehicles.css'

/**
 * The fleet's category vocabulary, managed by the office (ADR-0050).
 *
 * ## What this screen has to be honest about
 *
 * A rate card version is **immutable**, so nothing — not this screen, not
 * the server — can add a price to a tariff that already exists. A category
 * created here is therefore unpriced everywhere until Finance writes a new
 * version, and until then a vehicle of that kind cannot be quoted or
 * invoiced at all.
 *
 * The owner was offered three ways to handle that and chose this one: create
 * it immediately, **say which cards do not price it**, and link to the place
 * where somebody with the authority to set a price can set one. The two
 * rejected options were refusing the create until it was priced (which
 * forces a pricing decision onto a fleet manager) and auto-minting a version
 * at zero (which is a free trip on a real tariff nobody approved).
 *
 * `docs/screen-rules.md` §1 is the rule underneath: the warning renders as a
 * named list of cards, never as `UGX 0`. A zero reads as a free ride.
 *
 * ## Delete versus retire
 *
 * The server refuses `DELETE` with a 409 when a vehicle, a rate card price
 * or an issued invoice line names the key, because those columns are plain
 * strings with no foreign key — deliberately, so an invoice reproduces
 * without joining a table somebody can rename. The dialog below turns that
 * refusal into the action that actually resolves it rather than leaving the
 * office at a dead end.
 */
export function VehicleCategoriesPanel({
  categories,
  error,
  canManage,
  onChanged,
}: {
  /** Null while loading. */
  categories: VehicleCategory[] | null
  error: string | null
  canManage: boolean
  onChanged: () => Promise<void> | void
}) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState<VehicleCategory | 'new' | null>(null)
  const [deleting, setDeleting] = useState<VehicleCategory | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const retire = async (category: VehicleCategory, active: boolean) => {
    setProblem(null)

    try {
      await apiClient.patch(`/vehicle-categories/${category.id}`, { active })
      await onChanged()
    } catch (failure) {
      setProblem(apiError(failure, 'That could not be saved.').message)
    }
  }

  const columns = useMemo<DataColumn<VehicleCategory>[]>(
    () => [
      {
        key: 'name',
        card: 'title',
        header: 'Category',
        sortable: true,
        render: (row) => (
          <span className="kr-categories__name">
            <span>{row.name}</span>
            {/* The string an invoice line and a rate card rate actually
                hold. An operator reconciling a report reads it here rather
                than guessing that "SUV" is stored as `suv`. */}
            <span className="kr-categories__key">{row.key}</span>
          </span>
        ),
      },
      {
        key: 'description',
        card: 'meta',
        header: 'Notes',
        // An em dash, not a blank cell: "nothing was written here" is a
        // different reading from "this failed to load".
        render: (row) => <>{row.description ?? '—'}</>,
      },
      {
        key: 'vehicles_count',
        card: 'meta',
        header: 'Vehicles',
        numeric: true,
        sortable: true,
        render: (row) => <>{row.vehicles_count ?? '—'}</>,
      },
      {
        key: 'unpriced_rate_cards',
        card: 'status',
        header: 'Pricing',
        render: (row) => (
          <PricingCell
            category={row}
            onPrice={(cardId) =>
              // The version dialog on the rate cards page, opened on the card
              // that is missing this category with an empty row for it already
              // added. The alternative is telling a fleet manager to go and
              // find it, which is how a warning becomes something people learn
              // to ignore.
              navigate('/rate-cards', { state: { priceCategory: row.key, cardId } })
            }
          />
        ),
      },
      {
        key: 'active',
        card: 'status',
        header: 'Offered',
        render: (row) =>
          row.active ? (
            <Badge tone="success" icon="circle-check">
              Offered
            </Badge>
          ) : (
            // Icon and word both — never colour alone (DESIGN.md §8).
            <Badge tone="neutral" icon="archive">
              Retired
            </Badge>
          ),
      },
      {
        key: 'id',
        card: 'meta',
        header: '',
        render: (row) =>
          canManage ? (
            <span className="kr-categories__actions">
              <Button size="sm" variant="secondary" onClick={() => setEditing(row)}>
                Edit
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void retire(row, !row.active)}>
                {row.active ? 'Retire' : 'Offer again'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setDeleting(row)}>
                Delete
              </Button>
            </span>
          ) : null,
      },
    ],
    // `retire` and `navigate` are stable enough for a table redrawn on every
    // parent render anyway; `canManage` is the one that changes what renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canManage],
  )

  const unpricedCount = (categories ?? []).filter(
    (category) => category.active && (category.unpriced_rate_cards ?? []).length > 0,
  ).length

  return (
    <div className="kr-categories">
      {error !== null && <Alert tone="error">{error}</Alert>}
      {problem !== null && <Alert tone="error">{problem}</Alert>}

      {unpricedCount > 0 && (
        <Alert tone="warning" title="Some categories cannot be invoiced yet">
          {unpricedCount === 1
            ? 'One offered category is not priced on every rate card.'
            : `${unpricedCount} offered categories are not priced on every rate card.`}{' '}
          A trip in one of them cannot be quoted or invoiced against the cards listed below. A rate
          card version is never edited, so the price goes on a new version.
        </Alert>
      )}

      {canManage && (
        <div>
          <Button iconLeft="plus" onClick={() => setEditing('new')}>
            New category
          </Button>
        </div>
      )}

      <DataTable<VehicleCategory>
        columns={columns}
        rows={categories ?? []}
        emptyMessage={categories === null ? 'Loading…' : 'No categories yet'}
      />

      {editing !== null && (
        <CategoryFormDialog
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await onChanged()
            setEditing(null)
          }}
        />
      )}

      {deleting !== null && (
        <DeleteCategoryDialog
          category={deleting}
          onClose={() => setDeleting(null)}
          onDone={async () => {
            await onChanged()
            setDeleting(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * Whether a tariff can bill this category, and the way out when one cannot.
 *
 * `rate_cards_total === 0` is its own case and renders as an em dash rather
 * than a reassuring tick: with no active rate card at all, "priced
 * everywhere" would be true and useless.
 */
function PricingCell({
  category,
  onPrice,
}: {
  category: VehicleCategory
  onPrice: (cardId: number) => void
}) {
  const unpriced = category.unpriced_rate_cards ?? []

  if (category.rate_cards_total === undefined || category.rate_cards_total === 0) {
    return <span title="There is no active rate card to price against.">—</span>
  }

  if (unpriced.length === 0) {
    return (
      <Badge tone="success" icon="circle-check">
        Priced
      </Badge>
    )
  }

  /*
   * One card is named; several are counted.
   *
   * Joining the names read **"Not priced on Corporate Standard, Corporate
   * Standard"** on the real database, because two clients each have a card
   * by that name — rate card names are unique per tenant, not per platform,
   * and a Super Admin sees every tenant's. Only opening the screen showed
   * it; every fixture in the test file had distinct names.
   *
   * The count is unambiguous where the list was not, and it also gives the
   * row back about 200px — this table was clipping its Delete button off
   * the right edge at 1440px.
   *
   * They are still fixed one at a time, which is correct rather than a
   * compromise: each needs its own new rate card version, and the list
   * refreshes to name whichever is left.
   */
  const label =
    unpriced.length === 1
      ? `Not priced on ${unpriced[0].name}`
      : `Not priced on ${unpriced.length} rate cards`

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
      <Badge tone="warning" icon="triangle-alert" title={unpriced.map((c) => c.name).join(', ')}>
        {label}
      </Badge>
      <Button size="sm" variant="secondary" onClick={() => onPrice(unpriced[0].id)}>
        Price it
      </Button>
    </span>
  )
}

/**
 * Creating and renaming a category.
 *
 * **`key` is offered on create and never on edit**, which is the shape of
 * ADR-0050 §2 rather than a UI convenience. The key is what
 * `invoice_lines.vehicle_category` stores on documents already sent to
 * clients; renaming it would leave them naming nothing, silently. The server
 * answers 422 to a `key` on a PATCH, so this is the honest half of a rule
 * that holds either way.
 */
function CategoryFormDialog({
  category,
  onClose,
  onSaved,
}: {
  category: VehicleCategory | null
  onClose: () => void
  onSaved: () => void
}) {
  const editing = category !== null

  const [key, setKey] = useState(category?.key ?? '')
  const [name, setName] = useState(category?.name ?? '')
  const [description, setDescription] = useState(category?.description ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * The key is suggested from the name and stays editable.
   *
   * Typing it twice is the sort of thing that produces `mini_bus` beside
   * `minibus`, and the two would be different categories forever. It is only
   * a suggestion: once the field is touched it is left alone, because the
   * office may well have a key their reports already use.
   */
  const [keyTouched, setKeyTouched] = useState(false)

  const suggestKey = (from: string) =>
    from
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')

  const submit = async () => {
    setBusy(true)
    setErrors({})
    setProblem(null)

    try {
      if (editing) {
        // No `key`. Not "the server ignores it" — the server refuses it, and
        // sending it would turn a rename into a 422 the office cannot act on.
        await apiClient.patch(`/vehicle-categories/${category.id}`, {
          name: name.trim(),
          description: description.trim() === '' ? null : description.trim(),
        })
      } else {
        await apiClient.post('/vehicle-categories', {
          key: key.trim(),
          name: name.trim(),
          description: description.trim() === '' ? null : description.trim(),
        })
      }
      onSaved()
    } catch (failure) {
      const problem = apiError(failure, 'That could not be saved.')
      setErrors(fieldErrors(problem))
      setProblem(Object.keys(problem.errors).length === 0 ? problem.message : null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      width={520}
      title={editing ? `Edit ${category.name}` : 'New vehicle category'}
      description={
        editing
          ? undefined
          : 'It will be choosable straight away — and unpriced until a rate card version includes it.'
      }
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || name.trim() === '' || (!editing && key.trim() === '')}
          >
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create category'}
          </Button>
        </>
      }
    >
      <div className="kr-vehicle-form">
        {problem !== null && <Alert tone="error">{problem}</Alert>}

        <FormField label="Name" htmlFor="category-name" required error={errors.name}>
          <Input
            id="category-name"
            value={name}
            autoComplete="off"
            placeholder="Minibus (14-seat)"
            onChange={(e) => {
              setName(e.target.value)
              if (!editing && !keyTouched) setKey(suggestKey(e.target.value))
            }}
          />
        </FormField>

        {editing ? (
          <FormField
            label="Key"
            hint="Set once and never changed — rate card prices and issued invoice lines store it."
          >
            <p className="kr-categories__key" style={{ margin: 0 }}>
              {category.key}
            </p>
          </FormField>
        ) : (
          <FormField
            label="Key"
            htmlFor="category-key"
            required
            hint="Lowercase, underscores. Stored on every vehicle and invoice line, and never changed afterwards."
            error={errors.key}
          >
            <Input
              id="category-key"
              value={key}
              autoComplete="off"
              placeholder="minibus_14"
              onChange={(e) => {
                setKeyTouched(true)
                setKey(e.target.value)
              }}
            />
          </FormField>
        )}

        <FormField
          label="Notes"
          htmlFor="category-description"
          hint="Optional. For the office's own disambiguation."
          error={errors.description}
        >
          <Textarea
            id="category-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>
      </div>
    </Dialog>
  )
}

/**
 * Deleting a category, and the retirement it becomes when something already
 * names the key.
 *
 * The 409's message already says what is holding it and what to do; this
 * dialog puts the button beside the sentence. Sending somebody who has just
 * been refused back to the table to find a different control is how a
 * platform teaches people that its refusals are obstacles rather than
 * information.
 */
function DeleteCategoryDialog({
  category,
  onClose,
  onDone,
}: {
  category: VehicleCategory
  onClose: () => void
  onDone: () => void
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [inUse, setInUse] = useState(false)
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    setBusy(true)
    setMessage(null)

    try {
      await apiClient.delete(`/vehicle-categories/${category.id}`)
      onDone()
    } catch (failure) {
      const problem = apiError(failure, 'Could not delete this category.')
      setInUse(problem.code === 'VEHICLE_CATEGORY_IN_USE')
      setMessage(problem.message)
    } finally {
      setBusy(false)
    }
  }

  const retire = async () => {
    setBusy(true)
    setMessage(null)

    try {
      await apiClient.patch(`/vehicle-categories/${category.id}`, { active: false })
      onDone()
    } catch (failure) {
      setMessage(apiError(failure, 'Could not retire this category.').message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      tone="destructive"
      title={`Delete ${category.name}?`}
      description={
        'Deleting is only possible while no vehicle, rate card price or invoice line names it. ' +
        'Otherwise, retire it instead.'
      }
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {inUse ? (
            <Button loading={busy} onClick={() => void retire()}>
              Retire it instead
            </Button>
          ) : (
            <Button variant="destructive" loading={busy} onClick={() => void remove()}>
              Delete category
            </Button>
          )}
        </>
      }
    >
      {message !== null && (
        <Alert tone={inUse ? 'warning' : 'error'} title={inUse ? 'Still in use' : 'Not deleted'}>
          {message}
        </Alert>
      )}
    </Dialog>
  )
}
