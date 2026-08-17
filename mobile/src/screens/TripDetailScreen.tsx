import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Alert, Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Trip } from '../api/types';
import { formatMoney } from '../duty/offerPresentation';
import type { TripsStackParams } from '../navigation/types';
import { useSync } from '../offline/SyncProvider';
import { dialPassenger } from '../trips/contact';
import { useTrip, useTripEvents } from '../trips/queries';
import {
  cashNote,
  distanceLabel,
  minutesLabel,
  recordDate,
  recordIdentifier,
  railAnnouncement,
  recordMoney,
  recordRows,
  waitingMinutesFrom,
  type RecordRow,
} from '../trips/record';
import { driverActions, statusLabel, type TripAction } from '../trips/transitions';
import { Button, Card, Field, Notice, Screen, ScreenHeader, usePressScale } from '../ui/components';
import { SkeletonCards } from '../ui/Skeleton';
import { DetailRow, GLYPH, Stat, StatRow } from '../ui/facts';
import {
  CameraIcon,
  ClockIcon,
  CopyIcon,
  HeadsetIcon,
  PackageIcon,
  PauseIcon,
  PhoneIcon,
  RouteIcon,
  WalletIcon,
} from '../ui/icons';
import { SyncBanner } from '../ui/SyncBanner';
import { rowWhen } from '../wallet/presentation';
import { StatementRow } from '../wallet/StatementRow';
import { colors, radius, spacing, typography } from '../ui/theme';

type Props = NativeStackScreenProps<TripsStackParams, 'TripDetail'>;

/**
 * One trip, read back — **the record, and the only page there is for one.**
 *
 * ## One screen for every kind of job
 *
 * A ride and a delivery are the same record with different words in it, so this
 * screen takes `service_type` and words itself accordingly rather than there
 * being two pages to keep in step. The rail says *Parcel collected* or
 * *Passenger aboard*; the parcel row appears only where there is a parcel.
 *
 * ## It is not only the completed trip the mockup drew
 *
 * `tripDestination()` sends four more states here, and each one has to read
 * correctly:
 *
 * - **`assigned`** — a corporate trip nobody has answered. Every figure is
 *   absent, the rail is two places with no times, and the **Accept / Decline**
 *   controls are the point of the screen. This is why the actions and the
 *   decline-notes flow are still here.
 * - **`cancelled`, `no_show`, `rejected`** — the rail names how it ended and the
 *   drop-off says the place was never reached.
 *
 * A screen that only knew how to draw the happy path would break four states,
 * and `docs/screen-rules.md` §1 is what fills them: an em dash and a reason,
 * never a zero.
 *
 * ## What the mockup asked for and could not have
 *
 * - **Stops.** There are none in this platform — see `trips/record.ts`. The rail
 *   is `trip_events`, which is the append-only timeline billing derives waiting
 *   from, so every row happened.
 * - **A fare breakdown** (base fare, distance, waiting). `TripPricingEngine` is
 *   pure and writes nothing; a walk-in keeps one total. The summary is the
 *   driver's **ledger rows**, which are stored, and they are rendered with
 *   `StatementRow` — the wallet's own component — so a tip reads here exactly as
 *   it reads there.
 * - **A passenger photo and a ★4.8.** Customers have no photograph and
 *   ADR-0030's ratings run the other way. The fifth screen to refuse both.
 *
 * ## Why this does not fork `RouteRail`
 *
 * `ui/facts.tsx`'s rail answers "where does this job start and end" for three
 * live-leg screens. This one answers "what happened, in order, and when" — a
 * timeline with pills and times, of unbounded length. Bending one component to
 * do both would make the live screens carry a timeline's machinery. If a second
 * screen ever needs a timeline rail, this is the thing to extract.
 */
export function TripDetailScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const { data: trip, isLoading } = useTrip(tripId);
  const { data: events } = useTripEvents(tripId);
  const { queueTransition } = useSync();

  const [declining, setDeclining] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  /*
    The clock, read once at mount.

    A lazy `useState` rather than `Date.now()` in the body: reading a clock
    during render is impure and `react-hooks/purity` refuses it — rightly, since
    a value that changes on every render is invisible to the compiler's
    memoisation. `usePressScale` takes the same shape for the same reason.

    **One reading is enough here, and that is a property of this screen rather
    than a shortcut.** `now` is used for exactly one thing: measuring a waiting
    period that is still open. A paused trip is a *live* trip and
    `tripDestination()` sends it to `TripInProgress`, which owns a ticking clock;
    this screen is the record, read at a standstill, and a figure that ticked on
    it would be motion on a surface that should not move.
  */
  const [now] = useState(() => Date.now());

  const header = (
    <ScreenHeader
      title="Trip Details"
      subtitle={null}
      onBack={() => navigation.goBack()}
      action={
        <HelpPill
          onPress={() => navigation.getParent()?.navigate('Profile', { screen: 'Support' })}
        />
      }
    />
  );

  if (isLoading && trip === undefined) {
    return (
      <Screen>
        {header}
        <SyncBanner />
        <SkeletonCards count={1} style={styles.loading} />
      </Screen>
    );
  }

  if (trip === undefined) {
    return (
      <Screen>
        {header}
        <SyncBanner />
        <View style={styles.body}>
          <Notice message="This trip is not on this phone, and the office is unreachable." />
        </View>
      </Screen>
    );
  }

  const actions = driverActions(trip);
  // Bound to a local so the null check narrows inside the press handler —
  // TypeScript cannot prove a property is still non-null by the time a callback
  // runs, and it is right not to.
  const passenger = trip.passenger_contact;
  const lines = trip.earnings?.lines ?? [];
  const money = recordMoney(lines);
  const currency = money.currency ?? trip.fare?.currency ?? null;

  const run = async (action: TripAction) => {
    // The two readings are the product. They get their own screen rather than
    // an inline field, because a number typed by mistake here becomes a billing
    // dispute later.
    if (action.requires === 'odometer_start' || action.requires === 'odometer_end') {
      navigation.navigate('Odometer', {
        tripId: trip.id,
        to: action.to as 'trip_started' | 'trip_completed',
        from: trip.status,
      });

      return;
    }

    if (action.requires === 'notes') {
      setDeclining(true);

      return;
    }

    setBusy(true);
    await queueTransition({ tripId: trip.id, from: trip.status, to: action.to });
    setBusy(false);
  };

  const confirmDecline = async () => {
    if (notes.trim().length === 0) {
      return;
    }

    Alert.alert('Decline this trip?', 'It goes back to dispatch and is recorded against you.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Decline',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await queueTransition({
              tripId: trip.id,
              from: trip.status,
              to: 'rejected',
              notes: notes.trim(),
            });
            setDeclining(false);
            setNotes('');
          })();
        },
      },
    ]);
  };

  return (
    <Screen>
      {header}
      <SyncBanner />

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <IdentityCard trip={trip} events={events} passenger={passenger} />

        <StatRow>
          {[
            <Stat
              key="distance"
              icon={<RouteIcon {...GLYPH} />}
              label="Distance"
              value={distanceLabel(trip.distance_km)}
            />,
            <Stat
              key="duration"
              icon={<ClockIcon {...GLYPH} />}
              label="Duration"
              value={minutesLabel(trip.duration_minutes)}
            />,
            <Stat
              key="waiting"
              icon={<PauseIcon size={GLYPH.size} color={GLYPH.color} />}
              label="Waiting"
              // From the timeline — the same rows billing counts — and null
              // rather than zero on a trip that never started. A cancelled job
              // did not wait nought minutes; waiting was never possible on it.
              value={minutesLabel(waitingMinutesFrom(trip, events, now))}
            />,
            <Stat
              key="earned"
              icon={<WalletIcon {...GLYPH} />}
              label="Earnings"
              // The exact figure, never `compactMoney`: this is the number a
              // driver is paid, and a `K` figure hides under a hundred
              // shillings of it.
              value={
                lines.length === 0 || currency === null
                  ? null
                  : formatMoney(money.earnedMinor, currency)
              }
              emphasis
            />,
          ]}
        </StatRow>

        {trip.package !== null && (
          <DetailRow
            icon={<PackageIcon {...GLYPH} />}
            label="Parcel"
            value={parcelLabel(trip)}
            caption="What the order said was being sent."
          />
        )}

        <Card>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Trip route</Text>

            {/*
              Only where there is a map to open. `TripMapScreen` needs
              coordinates, and an order taken over the phone has none — a link
              that opened an empty map would be worse than no link.
            */}
            {trip.pickup.latitude !== null && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="View this trip on the map"
                // A real target, not a bare word with `hitSlop` behind it: 14pt
                // text is about 20 tall, and this app's floor is 44 even for a
                // control that only navigates.
                style={styles.linkTarget}
                onPress={() => navigation.navigate('TripMap', { tripId: trip.id })}
              >
                <Text style={styles.link}>View on map</Text>
              </Pressable>
            )}
          </View>

          <Rail rows={recordRows(trip, events, now)} />
        </Card>

        <Card>
          <Text style={styles.cardTitle}>Trip summary</Text>

          {lines.length === 0 ? (
            /*
              The state a driver sees most often, and the mockup does not draw
              it. Completion travels through the outbox (ADR-0023), so the phone
              usually reaches this screen before the server has credited
              anything — and upcountry it may stay that way for hours.
            */
            <Text style={styles.note}>
              {trip.status === 'trip_completed'
                ? 'The office has not confirmed the money yet.'
                : 'Nothing has been paid on this trip.'}
            </Text>
          ) : (
            <>
              {lines.map((line) => (
                <StatementRow key={line.id} entry={line} />
              ))}

              <View style={styles.total}>
                <Text style={styles.totalLabel}>You earned</Text>
                <Text style={styles.totalValue}>
                  {currency === null ? '—' : formatMoney(money.earnedMinor, currency)}
                </Text>
              </View>

              {/*
                Credits only, and the sentence below carries the other half.
                Summing the pair would report a finished cash ride as roughly
                *minus the commission* — the trap `Modules/Drivers/README.md`
                records, on the one screen where a driver is looking straight at
                the cash in question.
              */}
              {currency !== null && cashNote(money.cashHeldMinor, formatMoney(money.cashHeldMinor, currency)) !== null && (
                <Text style={styles.note}>
                  {cashNote(money.cashHeldMinor, formatMoney(money.cashHeldMinor, currency))}
                </Text>
              )}

              {/*
                When the ledger credited it, which is *not* the instant the trip
                ended — completion travels through the outbox, and the credit is
                written when the office receives it. `rowWhen` is the wallet's
                own formatter, used here rather than a second one so this line
                and the four rows above it cannot word the same fact two ways.
              */}
              {trip.earnings?.recorded_at !== undefined && trip.earnings.recorded_at !== null && (
                <Text style={styles.paid}>
                  Paid into your wallet · {rowWhen(trip.earnings.recorded_at)}
                </Text>
              )}
            </>
          )}
        </Card>

        <Card>
          <Text style={styles.cardTitle}>Odometer</Text>
          <OdometerLine
            label="Opening"
            value={trip.odometer_start}
            photo={trip.odometer_start_photo_url}
          />
          <OdometerLine
            label="Closing"
            value={trip.odometer_end}
            photo={trip.odometer_end_photo_url}
          />

          {/*
            Both distances, where both exist, because the pair is the point:
            ADR-0035 reconciles a typed reading against the route GPS recorded,
            and a variance is what an auditor looks for.
          */}
          {trip.gps_distance_km !== null && (
            <Text style={styles.note}>
              GPS measured {distanceLabel(trip.gps_distance_km)} on this journey.
              {trip.distance_variance_flagged ? ' The office has flagged the difference.' : ''}
            </Text>
          )}
        </Card>

        {actions.length > 0 && (
          <View style={styles.actions}>
            {actions.map((action) => (
              <Button
                key={action.to}
                label={action.label}
                tone={action.tone}
                busy={busy}
                onPress={() => void run(action)}
              />
            ))}
          </View>
        )}

        {declining && (
          <Card>
            <Field
              label="Why are you declining?"
              hint="The office sees this. It is required."
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
            />
            <Button
              label="Confirm decline"
              tone="danger"
              disabled={notes.trim().length === 0}
              onPress={() => void confirmDecline()}
            />
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

/**
 * The status, when it happened, who it was for, and the reference.
 *
 * **No photograph and no rating**, which is the fifth time this app has refused
 * both: `ContactDetails` is `{name, phone, label}` because customers have no
 * picture, and ADR-0030's ratings run customer-to-driver and are withheld below
 * five. A stock face would misidentify the person a dispute is about.
 */
function IdentityCard({
  trip,
  events,
  passenger,
}: {
  trip: Trip;
  events: Parameters<typeof recordRows>[1];
  passenger: Trip['passenger_contact'];
}) {
  const identifier = recordIdentifier(trip);
  const date = recordDate(events);

  return (
    <Card>
      <Text style={[styles.status, statusTone(trip)]}>{statusLabel(trip.status)}</Text>

      {/*
        The date and the first clock reading, both rendered by the server in the
        fleet's zone. **Deliberately not "Today, 15 Aug"**: today and yesterday
        are the server's keys, and a handset computing them from its own clock
        files an evening's work under the wrong day — see `trips/record.ts`.
      */}
      <Text style={styles.when}>{date ?? '—'}</Text>

      <View style={styles.identity}>
        <View style={styles.identityText}>
          <Text style={styles.identityLabel}>
            {trip.service_type === 'delivery' ? 'Sender' : 'Customer'}
          </Text>
          {/*
            The name only where ADR-0024 §7 releases it: a walk-in, and from the
            accept through completion — `DirectContactChannel` includes
            `trip_completed` on purpose, because that is when somebody rings back
            about a bag left on the seat. A corporate trip, a cancellation and a
            no-show all have no name, and there is no rule to re-implement here:
            the field is present or it is not.
          */}
          <Text style={styles.identityName}>{passenger?.name ?? 'Not released'}</Text>
        </View>

        {passenger !== null && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Call ${passenger.name}`}
            onPress={() => void dialPassenger(passenger)}
            style={styles.callButton}
          >
            <PhoneIcon size={18} color={colors.primaryText} strokeWidth={2} />
            <Text style={styles.callLabel}>Call</Text>
          </Pressable>
        )}
      </View>

      <Reference label={identifier.label} value={identifier.value} />
    </Card>
  );
}

/**
 * The identifier, and a way to get it off the phone.
 *
 * A driver reading twelve characters down a bad line gets them wrong; copying it
 * into a message does not. The label says *which* identifier it is, because a
 * corporate trip has no customer reference and quoting a database id as though
 * it were one would have the driver and the office looking for different things.
 */
function Reference({ label, value }: { label: string; value: string }) {
  const press = usePressScale();
  const [copied, setCopied] = useState(false);

  return (
    <View style={styles.reference}>
      <View style={styles.referenceText}>
        <Text style={styles.identityLabel}>{label}</Text>
        <Text style={styles.referenceValue}>{value}</Text>
      </View>

      <Animated.View style={{ transform: [{ scale: press.scale }] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Copy ${label}, ${value}`}
          accessibilityState={{ selected: copied }}
          hitSlop={8}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          onPress={() => {
            void Clipboard.setStringAsync(value);
            // Said in words as well as by the glyph changing, and it stays said
            // — there is no timer to reset it, because a message that vanishes
            // while a driver is still looking at the screen is a message they
            // will wonder whether they saw.
            setCopied(true);
          }}
          style={styles.copyButton}
        >
          <CopyIcon size={18} color={colors.textMuted} strokeWidth={2} />
          <Text style={styles.copyLabel}>{copied ? 'Copied' : 'Copy'}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** The Help pill from the mockup — the one trailing control this header has. */
function HelpPill({ onPress }: { onPress: () => void }) {
  const press = usePressScale();

  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Help with this trip"
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={styles.help}
      >
        <HeadsetIcon size={18} color={colors.primaryText} strokeWidth={2} />
        <Text style={styles.helpLabel}>Help</Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The timeline, on a rail.
 *
 * **Shape before colour, and a word beside both.** Each row carries its own pill
 * in words — "Completed", "7 min", "Not reached" — so the tint is redundant
 * emphasis rather than the carrier of any meaning (`docs/screen-rules.md` §6).
 * The dots differ in fill as well as hue for the significant number of men in
 * this fleet who cannot reliably separate green from red.
 */
function Rail({ rows }: { rows: RecordRow[] }) {
  return (
    <View>
      {rows.map((row, index) => (
        <View
          key={`${row.kind}-${index}`}
          // One composed sentence per row. `docs/screen-rules.md` §6: a grid
          // left to linearise reads as four disconnected fragments — "Pickup",
          // "08:30 AM", "Acacia Mall", "Completed" — and a driver listening to
          // a rail needs them as one statement about one moment.
          accessible
          accessibilityLabel={railAnnouncement(row)}
          style={styles.railRow}
        >
          <View style={styles.railGutter}>
            <View style={[styles.railDot, dotStyle(row)]} />
            {index < rows.length - 1 && <View style={styles.railLine} />}
          </View>

          <View style={styles.railText}>
            <View style={styles.railHead}>
              <Text style={[styles.railLabel, toneStyle(row.tone)]}>{row.label}</Text>
              {row.time !== null && <Text style={styles.railTime}>{row.span ?? row.time}</Text>}
            </View>

            {row.place !== null && (
              <Text style={styles.railPlace} numberOfLines={2}>
                {row.place}
              </Text>
            )}
          </View>

          <View style={[styles.pill, pillStyle(row.tone)]}>
            <Text style={[styles.pillLabel, toneStyle(row.tone)]}>{row.pill}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function OdometerLine({
  label,
  value,
  photo,
}: {
  label: string;
  value: number | null;
  photo: string | null;
}) {
  return (
    <View style={styles.odometerLine}>
      <Text style={styles.note}>{label}</Text>

      <View style={styles.odometerReading}>
        <Text style={styles.odometerValue}>
          {value === null ? '—' : `${value.toLocaleString()} km`}
        </Text>

        {/*
          A vector, where a 📷 used to be. DESIGN.md § Icons bans emoji as
          interface iconography — an emoji is drawn by the platform's own font,
          so it differs on every handset, ignores the colour it is given and
          does not scale with its type.

          Labelled rather than left as a bare glyph: an icon carries meaning
          only alongside an accessible name, and "there is a photo of this
          reading" is the whole point of the mark on a screen an auditor reads.
        */}
        {photo !== null && (
          <View accessible accessibilityLabel="Dashboard photo captured">
            <CameraIcon color={colors.textMuted} size={16} />
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * "Documents · Small", or whichever half the order actually carried.
 *
 * Both keys are optional on the public order form, so null is the common case
 * and renders as an em dash rather than as a guess about what somebody is
 * carrying.
 */
function parcelLabel(trip: Trip): string | null {
  const parts: string[] = [];

  const item = trip.package?.item_type ?? null;
  const size = trip.package?.package_size ?? null;

  if (item !== null) {
    parts.push(sentence(item));
  }

  if (size !== null) {
    parts.push(sentence(size));
  }

  return parts.length === 0 ? null : parts.join(' · ');
}

function sentence(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1).replace(/_/g, ' ')}`;
}

function statusTone(trip: Trip) {
  if (trip.status === 'trip_completed') {
    return { color: colors.primaryText };
  }

  return trip.status === 'cancelled' || trip.status === 'no_show'
    ? { color: colors.danger }
    : { color: colors.textMuted };
}

function toneStyle(tone: RecordRow['tone']) {
  switch (tone) {
    case 'good':
      return { color: colors.primaryText };
    case 'warning':
      return { color: colors.warning };
    case 'danger':
      return { color: colors.danger };
    default:
      return { color: colors.textMuted };
  }
}

function pillStyle(tone: RecordRow['tone']) {
  switch (tone) {
    case 'good':
      return { backgroundColor: colors.successTint };
    case 'warning':
      return { backgroundColor: colors.warningTint };
    case 'danger':
      return { backgroundColor: colors.dangerTint };
    default:
      return { backgroundColor: colors.surfaceSunken };
  }
}

function dotStyle(row: RecordRow) {
  // Filled for something that happened, hollow for something that has not —
  // the shape carries it, and the pill says it in words.
  const colour = toneStyle(row.tone).color;

  return row.pill === 'Not reached'
    ? { borderColor: colors.borderStrong, backgroundColor: colors.surface }
    : { borderColor: colour, backgroundColor: colour };
}

const styles = StyleSheet.create({
  body: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  loading: {
    // Was a Text style for the word "Loading…"; the placeholder that
    // replaced it wants the gutter and nothing else.
    padding: spacing.md,
  },
  help: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 4,
    // Shorter than the 52pt floor deliberately: this is a header affordance
    // beside a 44pt back arrow, and `hitSlop` is not what makes it reachable —
    // the row it sits in is 44 tall.
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  helpLabel: {
    ...typography.captionStrong,
    color: colors.primaryText,
  },
  status: {
    ...typography.captionStrong,
    marginBottom: spacing.xs,
  },
  when: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  identityText: {
    flex: 1,
  },
  identityLabel: {
    ...typography.caption,
    fontSize: 12,
    letterSpacing: 0.4,
    color: colors.textMuted,
  },
  identityName: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  callButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    // The one control on this card that posts nothing and dials somebody, so it
    // keeps the app's full tap floor rather than the header pill's 40.
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
  },
  callLabel: {
    ...typography.captionStrong,
    color: colors.primaryText,
  },
  reference: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  referenceText: {
    flex: 1,
  },
  referenceValue: {
    ...typography.bodyStrong,
    // Mono, because it is an identifier being read out character by character —
    // DESIGN.md §6 reserves JetBrains Mono for exactly this.
    fontFamily: 'JetBrainsMono_500Medium',
    color: colors.text,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 4,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
  },
  copyLabel: {
    ...typography.captionStrong,
    color: colors.textMuted,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // No margin of its own: the title inside it already carries one, and both
    // put a double gap under the route heading.
  },
  cardTitle: {
    ...typography.label,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  linkTarget: {
    minHeight: 44,
    justifyContent: 'center',
    // Pulled to the edge so the enlarged target does not push the label off the
    // card's own gutter.
    paddingLeft: spacing.md,
  },
  link: {
    ...typography.captionStrong,
    color: colors.primaryText,
  },
  railRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm + 4,
  },
  railGutter: {
    alignItems: 'center',
    alignSelf: 'stretch',
    // Aligns the dot with the cap-height of the label beside it rather than
    // with its box top, which sits a couple of points high.
    paddingTop: 5,
  },
  railDot: {
    width: 12,
    height: 12,
    borderRadius: radius.pill,
    borderWidth: 3,
  },
  railLine: {
    width: 2,
    flex: 1,
    minHeight: spacing.md,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  railText: {
    flex: 1,
    paddingBottom: spacing.md,
  },
  railHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  railLabel: {
    ...typography.captionStrong,
    fontSize: 15,
  },
  railTime: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
    flexShrink: 1,
  },
  railPlace: {
    ...typography.body,
    color: colors.text,
    marginTop: 2,
  },
  pill: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.sm,
    marginTop: 2,
  },
  pillLabel: {
    ...typography.caption,
    fontSize: 12,
  },
  total: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalLabel: {
    ...typography.bodyStrong,
    color: colors.primaryText,
  },
  totalValue: {
    ...typography.bodyStrong,
    color: colors.primaryText,
    fontVariant: ['tabular-nums'],
  },
  paid: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  note: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  actions: {
    gap: spacing.sm + 4,
  },
  odometerReading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  odometerLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  odometerValue: {
    ...typography.label,
    color: colors.text,
  },
});
