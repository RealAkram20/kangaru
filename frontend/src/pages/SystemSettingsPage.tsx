import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { useAuth } from '../auth/useAuth'
import { Card } from '../components/core/Card'
import { Icon } from '../components/core/Icon'
import { Alert } from '../components/feedback/Alert'
import { EmptyState } from '../components/feedback/EmptyState'
import { apiClient } from '../lib/apiClient'
import { apiError } from '../lib/apiError'
import { PageContext, type SectionMeta } from './settings/state'
import type { SectionProps, Settings } from './settings/types'
import { AuthSection } from './settings/sections/AuthSection'
import { BillingSection } from './settings/sections/BillingSection'
import { BookingSection } from './settings/sections/BookingSection'
import { BrandingSection } from './settings/sections/BrandingSection'
import { LegalSection } from './settings/sections/LegalSection'
import { MailSection } from './settings/sections/MailSection'
import { MapsSection } from './settings/sections/MapsSection'
import { OrderingSection } from './settings/sections/OrderingSection'
import { PaymentsSection } from './settings/sections/PaymentsSection'
import { RegionalSection } from './settings/sections/RegionalSection'
import { SmsSection } from './settings/sections/SmsSection'
import { TrackingSection } from './settings/sections/TrackingSection'
import './settings/settings.css'

/**
 * Platform settings (ADR-0014) — the system's own name, contacts and defaults,
 * editable by whoever holds `settings.manage`.
 *
 * Like RolesPage, deliberately not behind RequireNavAccess: a custom role
 * holding the permission is invisible to a slug list, so the page gates on
 * whether the API answers — a 403 renders as an answer, not an apology.
 *
 * **Why it is a rail and twelve panes rather than twelve stacked cards.** The
 * old page was one 720px column: about four thousand pixels of scroll, the
 * right half of a widescreen empty, and a hint under nearly every control. The
 * three problems are one problem — a form laid out as a document. A rail turns
 * twelve groups into a place you go rather than a distance you travel, and
 * split rows turn each group into a list you scan rather than a stack you read.
 *
 * **Every pane stays mounted; only the active one is displayed.** Unmounting
 * would be cheaper by a few dozen inputs and would throw away what somebody had
 * typed the moment they checked something in another section. `display: none`
 * also takes a hidden pane out of the accessibility tree and the tab order, so
 * the cost is a larger DOM and nothing else — and it is the DOM this page
 * already had.
 *
 * Motion is deliberately quiet. A settings form is occasional-use chrome, so
 * nothing animates for decoration; the one earned animation is the switch
 * thumb, which is the control confirming it heard you.
 */

interface Section {
  meta: SectionMeta
  Component: ComponentType<SectionProps>
}

/**
 * The registry: what exists, what it is called, and what draws it.
 *
 * Titles and descriptions live here rather than beside each section's fields
 * so the whole page's voice can be read — and held to a limit — in one place.
 *
 * **The limit is one short line, and it is enforced by reading them together
 * rather than one at a time.** Each of these was defensible on its own; as a
 * column they were a wall, which is the state the owner asked twice to have
 * cleaned up. A description earns its line only by saying something the title
 * and the fields below it do not already say. Where none of them could, the
 * field simply has no description.
 */
/**
 * Groups that are Kangaru's copy of itself (ADR-0059), mirroring
 * `SettingsService::KANGARU_ONLY_GROUPS`.
 *
 * A fleet's settings write is already scoped to that fleet, so nothing here
 * prevents a leak — the server does. What it prevents is a fleet being handed
 * a form for the platform's own name, legal notices, public order page and
 * sign-in methods, submitting it, and getting a 404 from a tab the console
 * offered them. An offered door that refuses is worse than no door.
 */
const KANGARU_ONLY_GROUPS = ['branding', 'legal', 'ordering', 'auth']

const SECTIONS: Section[] = [
  {
    meta: {
      id: 'branding',
      group: 'branding',
      label: 'Branding',
      icon: 'sparkles',
      title: 'Branding',
      description: 'The name, marks and contacts the public sees.',
    },
    Component: BrandingSection,
  },
  {
    meta: {
      id: 'regional',
      group: 'regional',
      label: 'Regional',
      icon: 'clock',
      title: 'Regional defaults',
      description: 'Currency, timezone and date format.',
    },
    Component: RegionalSection,
  },
  {
    meta: {
      id: 'ordering',
      group: 'ordering',
      label: 'Public ordering',
      icon: 'form',
      title: 'Public ordering',
      description: 'The walk-in order form on the public site.',
    },
    Component: OrderingSection,
  },
  {
    meta: {
      id: 'booking',
      group: 'booking',
      label: 'Booking rules',
      icon: 'calendar-clock',
      title: 'Booking rules',
      description: 'How a corporate booking reaches dispatch.',
    },
    Component: BookingSection,
  },
  {
    meta: {
      id: 'tracking',
      group: 'tracking',
      label: 'Distance checks',
      icon: 'gauge',
      title: 'Distance checks',
      description: "How a trip's distance is checked.",
    },
    Component: TrackingSection,
  },
  {
    meta: {
      id: 'billing',
      group: 'billing',
      label: 'Driver pay',
      icon: 'banknote',
      title: 'Driver pay',
      description: 'What the platform keeps, and what pays a driver more. Future work only.',
    },
    Component: BillingSection,
  },
  {
    meta: {
      id: 'maps',
      group: 'maps',
      label: 'Maps and routing',
      icon: 'route',
      title: 'Maps and routing',
      description: 'Road routing for the Driver App. The maps themselves need no key.',
    },
    Component: MapsSection,
  },
  {
    meta: {
      id: 'mail',
      group: 'mail',
      label: 'Email',
      icon: 'mail',
      title: 'Email (SMTP)',
      // No description: "How the platform sends email" is what the title
      // already says. A description is not a slot to be filled.
    },
    Component: MailSection,
  },
  {
    meta: {
      id: 'sms',
      group: 'sms',
      label: 'SMS',
      icon: 'smartphone',
      title: 'SMS gateway',
      description: 'Held for the SMS launch. Nothing sends SMS yet.',
    },
    Component: SmsSection,
  },
  {
    meta: {
      id: 'payments',
      group: 'payments',
      label: 'Payment gateways',
      icon: 'wallet',
      title: 'Payment gateways',
      description: 'Held for the payments launch. Nothing charges anyone yet.',
    },
    Component: PaymentsSection,
  },
  {
    meta: {
      id: 'auth',
      group: 'auth',
      label: 'Sign-in methods',
      icon: 'key-round',
      title: 'Sign-in methods',
      description: 'What the Driver App offers on its welcome screen.',
    },
    Component: AuthSection,
  },
  {
    meta: {
      id: 'legal',
      group: 'legal',
      label: 'Terms and privacy',
      icon: 'file-text',
      title: 'Terms and privacy',
      description: "Shown in the Driver App's sign-up. A blank line starts a paragraph.",
    },
    Component: LegalSection,
  },
]

/**
 * The rail's own grouping, which is not the API's.
 *
 * `SettingsService` has twelve flat groups because that is the unit a PATCH
 * saves. An operator does not think in twelve; they think "what the public
 * sees", "how we run", "what we pay", "what we plug in". The headings are the
 * only place those five ideas exist, so they earn their line.
 */
const RAIL: { heading: string; ids: string[] }[] = [
  { heading: 'Platform', ids: ['branding', 'regional'] },
  { heading: 'Operations', ids: ['ordering', 'booking', 'tracking'] },
  { heading: 'Money', ids: ['billing'] },
  { heading: 'Connections', ids: ['maps', 'mail', 'sms', 'payments'] },
  { heading: 'Access and legal', ids: ['auth', 'legal'] },
]

export function SystemSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [refused, setRefused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { user } = useAuth()

  // The tabs this account may actually use. Filtered before `active` is
  // chosen, so the first tab is one that exists for them rather than a
  // Branding tab a fleet cannot open.
  const sections = useMemo(
    () =>
      user?.access_level === 'kangaru'
        ? SECTIONS
        : SECTIONS.filter((section) => !KANGARU_ONLY_GROUPS.includes(section.meta.group)),
    [user?.access_level],
  )

  const [active, setActive] = useState(sections[0].meta.id)
  const [dirty, setDirty] = useState<Record<string, boolean>>({})
  const panes = useRef<HTMLDivElement>(null)

  // Deliberately `.then()` rather than `await` inside an async helper, the
  // same shape DriversPage documents: `react-hooks/set-state-in-effect` reads
  // a synchronous call to a state-setting helper as a set during render, and
  // it is right to — the promise chain defers the write to a microtask, which
  // is what we mean.
  const load = useCallback(
    () =>
      apiClient
        .get('/settings')
        .then((response) => {
          setSettings(response.data.data.settings as Settings)
          setRefused(false)
          setError(null)
        })
        .catch((failure: unknown) => {
          const problem = apiError(failure, 'Could not load settings.')
          if (problem.code === 'FORBIDDEN') {
            setRefused(true)
            return
          }
          setError(problem.message)
        }),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  // Identity-stable, and a no-op when the answer has not changed: a section
  // reports on every render of its own state, and writing an equal value back
  // would re-render the page, re-render the section, and report again.
  const reportDirty = useCallback((id: string, isDirty: boolean) => {
    setDirty((current) => (current[id] === isDirty ? current : { ...current, [id]: isDirty }))
  }, [])

  const context = useMemo(() => ({ reportDirty }), [reportDirty])

  const show = (id: string) => {
    setActive(id)
    // The rail is sticky and the pane swaps beneath it, so without this a
    // reader who was halfway down Driver pay lands halfway down Email.
    panes.current?.scrollIntoView({ block: 'start' })
  }

  if (refused) {
    return (
      <Card>
        <EmptyState
          icon="lock"
          title="Platform settings are not available to your role"
          description="Changing the platform's name, contacts and defaults needs the settings permission. Ask a Super Admin if you need access."
        />
      </Card>
    )
  }

  if (error !== null) {
    return (
      <Alert tone="error" title="Settings" onDismiss={() => setError(null)}>
        {error}
      </Alert>
    )
  }

  if (settings === null) {
    return null
  }

  return (
    <PageContext.Provider value={context}>
      <div className="kr-settings">
        <nav className="kr-settings-rail" aria-label="Settings sections">
          {RAIL.map((group) => (
            <div className="kr-settings-rail-group" key={group.heading}>
              <span className="kr-settings-rail-heading">{group.heading}</span>
              {group.ids.map((id) => {
                const section = sections.find((candidate) => candidate.meta.id === id)
                if (!section) return null
                return (
                  <button
                    key={id}
                    type="button"
                    aria-current={active === id ? 'true' : undefined}
                    className="kr-settings-rail-item"
                    onClick={() => show(id)}
                  >
                    <Icon name={section.meta.icon} size={16} />
                    <span style={{ flex: 1, minWidth: 0 }}>{section.meta.label}</span>
                    {dirty[id] && (
                      <>
                        {/* Colour marks it; the clipped word is what says
                            what the mark means, so the state is never
                            carried by colour alone. */}
                        <span
                          aria-hidden="true"
                          style={{
                            width: 6,
                            height: 6,
                            flex: '0 0 auto',
                            borderRadius: 'var(--radius-pill)',
                            background: 'var(--kr-warning)',
                          }}
                        />
                        {/* The separating space is a text node here rather
                            than the first character of the clipped span:
                            inside it, accessible-name computation collapses
                            it away and the item announces as
                            "Brandingunsaved changes". Same trap FormField
                            documents for its "(required)". */}{' '}
                        <span className="kr-sr-only">unsaved changes</span>
                      </>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div ref={panes} style={{ minWidth: 0 }}>
          {sections.map(({ meta, Component }) => (
            <div key={meta.id} style={{ display: meta.id === active ? 'block' : 'none' }}>
              <Component settings={settings} section={meta} onSaved={setSettings} />
            </div>
          ))}
        </div>
      </div>
    </PageContext.Provider>
  )
}
