import { Alert } from '../../../components/feedback/Alert'
import { Input } from '../../../components/forms/Input'
import { Select } from '../../../components/forms/Select'
import { Switch } from '../../../components/forms/Switch'
import { Note, Row, SecretRow, SectionForm } from '../kit'
import { useSectionState, withSecrets } from '../state'
import type { SectionProps } from '../types'

/**
 * Routing for the Driver App's maps (`maps` group).
 *
 * **The maps themselves need no key.** They are MapLibre against CARTO's free
 * tiles, and they draw Kampala with or without anything on this section. What
 * is configured here is *routing*: the line that follows real roads, the road
 * distance, and the arrival estimate that comes with it. The description says
 * so, because an operator who thinks the map is broken without a key will go
 * and buy one they did not need.
 *
 * **The key is write-only** (ADR-0014 §3), and stricter than it looks for a
 * maps key: Directions bills per request, so a key that leaks into a browser
 * bundle is somebody else's traffic on this operator's invoice, and there is
 * nothing to reset that does not also break the feature.
 *
 * **The switch is separate from the key, and starts off.** Configuring a
 * credential must never silently start a bill, and stopping the spend must not
 * mean destroying the credential and having to find it again.
 */
export function MapsSection({ settings, onSaved, section }: SectionProps) {
  const maps = settings.maps
  const state = useSectionState({
    routing_enabled: maps.routing_enabled,
    routing_provider: maps.routing_provider as string,
    osrm_base_url: maps.osrm_base_url,
    api_key: '',
  })
  const { value, set } = state
  const google = value.routing_provider === 'google'

  return (
    <SectionForm
      section={section}
      state={state}
      onSaved={onSaved}
      secretKeys={['api_key']}
      payload={() =>
        withSecrets(
          {
            routing_enabled: value.routing_enabled,
            routing_provider: value.routing_provider,
            osrm_base_url: value.osrm_base_url,
          },
          { api_key: value.api_key },
        )
      }
    >
      {(errors) => (
        <>
          <Row
            label="Routing engine"
            htmlFor="settings-maps-provider"
            error={errors.routing_provider}
            control={320}
          >
            <Select
              id="settings-maps-provider"
              value={value.routing_provider}
              onChange={(event) => set('routing_provider', event.target.value)}
              options={[
                { value: 'osrm', label: 'OSRM — free, no key' },
                { value: 'google', label: 'Google Directions — paid, live traffic' },
              ]}
            />
          </Row>

          <Note>
            {google ? (
              <Alert tone="info" title="This one costs money per trip">
                The only setting here with a running cost. What it buys is live traffic.
              </Alert>
            ) : (
              <Alert tone="info" title="Free, and not yet ready for a real fleet">
                No key, no cost, and no live traffic. The default address is the
                project&rsquo;s demo server — rate-limited and not meant for production,
                so run your own before drivers depend on it.
              </Alert>
            )}
          </Note>

          <Row
            label="Calculate routes"
            htmlFor="settings-maps-enabled"
            hint={
              google
                ? 'Off keeps the key but makes no requests, so the spend stops.'
                : 'Off leaves a straight line instead of a road route.'
            }
          >
            <Switch
              id="settings-maps-enabled"
              checked={value.routing_enabled}
              onChange={(event) => set('routing_enabled', event.target.checked)}
            />
          </Row>

          {!google && (
            <Row
              label="OSRM server address"
              htmlFor="settings-maps-osrm"
              error={errors.osrm_base_url}
              required
            >
              <Input
                id="settings-maps-osrm"
                type="url"
                value={value.osrm_base_url}
                onChange={(event) => set('osrm_base_url', event.target.value)}
                required
              />
            </Row>
          )}

          {google && (
            <SecretRow
              label="Google Directions API key"
              htmlFor="settings-maps-api-key"
              secret={maps.api_key}
              value={value.api_key}
              onChange={(next) => set('api_key', next)}
              error={errors.api_key}
            />
          )}
        </>
      )}
    </SectionForm>
  )
}
