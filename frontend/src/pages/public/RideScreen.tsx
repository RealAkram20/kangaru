import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Heart,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  Share2,
  Star,
  Target,
  User,
} from 'lucide-react'
import { MapPanel, type VehicleKind } from './MapPanel'
import { searchPlaces } from './places'
import { isFavouriteCaptain, toggleFavouriteCaptain } from './favouriteCaptains'
import { OrderNav } from './OrderNav'
import {
  CANCEL_REASONS,
  createRideSource,
  type RideSource,
  formatUgx,
  INITIAL_RIDE_STATE,
  isCancellable,
  type Captain,
  type Fare,
  type RidePhase,
  type RideState,
} from './ride'
import './landing.css'

/**
 * How much of the phone the sheet takes. Declared once because two things
 * depend on it agreeing: the sheet's own max height, and the map's idea of
 * which strip of itself is still visible.
 *
 * The trip gets its own, much smaller figure. Once somebody is in the car
 * the sheet has almost nothing left to say — the route is not editable, the
 * fare is already agreed, and the only thing they might want is out. So the
 * map takes the screen and becomes the navigation, which is what a
 * passenger is actually looking at.
 */
const SHEET_FRACTION = 0.62
const SHEET_FRACTION_ON_TRIP = 0.34

/** The side-on sprite the fleet cards already use, per vehicle kind. */
const SIDE_SPRITES: Record<VehicleKind, string> = {
  sedan: '/assets/vehicles/side-economy.svg',
  suv: '/assets/vehicles/side-xl.svg',
  pickup: '/assets/vehicles/side-pickup.svg',
  boda: '/assets/vehicles/side-boda.svg',
}

/** The card every section of this sheet is built from. */
const CARD = 'rounded-2xl border border-border bg-surface-card p-5'

/**
 * The headline over the whole sheet, per phase. Once a captain is assigned
 * the headline moves *into* the captain card — it is about them, and a
 * separate title repeating it was two headings saying one thing.
 */
const PRE_ASSIGNMENT_COPY: Record<string, { title: string; body: string }> = {
  searching: {
    title: 'Finding you a captain',
    body: 'Looking for captains near your pickup.',
  },
  offered: {
    title: 'Captain found',
    body: 'Captain found! Waiting for confirmation.',
  },
  unmatched: {
    // Walk-in dispatch is automatic, so there is no desk staffed to ring
    // back. Promising a call nobody will make is worse than saying no.
    title: 'No captains free',
    body: 'No captain could take this one. Try again in a moment.',
  },
  cancelled: {
    title: 'Ride cancelled',
    body: 'This ride was called off. Nothing has been charged.',
  },
  trip_completed: {
    title: 'Trip complete',
    body: 'Hope it went well. Here is what you owe.',
  },
}

/**
 * Whether the passenger is in the car — the whole in-journey run, not just
 * the moment they got in.
 *
 * `passenger_onboard` is where the driver's app starts this sequence and
 * `trip_started` is where it books the opening odometer; `waiting` and
 * `trip_resumed` are a stop along the way. To this screen they are one state:
 * you are in the car and moving towards your destination.
 */
function isOnJourney(phase: RidePhase): boolean {
  return (
    phase === 'passenger_onboard' ||
    phase === 'trip_started' ||
    phase === 'waiting' ||
    phase === 'trip_resumed'
  )
}

/** The captain card's own headline, which is the thing being waited on. */
function captainHeadline(phase: RidePhase, captain: Captain, etaSeconds: number | null): string {
  if (phase === 'driver_arrived') return 'Your Captain is here'
  if (phase === 'waiting') return 'Stopped for a moment'
  if (isOnJourney(phase)) return 'On your trip'

  /*
   * No ETA at all is the normal case, not the exception.
   *
   * The live source sends `etaSeconds: null` and `etaMinutes: 0` on every
   * ride by design — ADR-0020 §3 ranks on straight-line distance, and a
   * minutes figure derived from it is a promise the platform cannot keep. The
   * old fallback read that zero as a countdown and told every real passenger
   * their captain arrived "in 0 min" while the rider was still kilometres
   * away. A screen that shows less is better than a screen that lies.
   */
  if (etaSeconds === null && captain.etaMinutes <= 0) {
    return 'Your Captain is on the way'
  }

  /*
   * Ceiling, not rounding. Rounding crosses each minute boundary halfway
   * through it, so the same number can appear to stall and then drop two —
   * and it reaches "0 min" while the captain is still driving. Ceiling
   * counts 6, 5, 4 … 1 and holds at 1 until they actually arrive, which is
   * both smoother and the honest way round to be wrong.
   */
  const minutes =
    etaSeconds === null ? captain.etaMinutes : Math.max(1, Math.ceil(etaSeconds / 60))
  return `Your Captain arrives in ${minutes} min`
}

export function RideScreen({
  reference,
  pickup,
  dropoff,
  near,
  from,
  to,
  source: injectedSource,
}: {
  /** The reference the order came back with; also seeds which captain matches. */
  reference: string
  pickup: string
  dropoff: string
  /** The device fix, for centring the map and placing the captain. */
  near: [number, number] | null
  from: [number, number] | null
  to: [number, number] | null
  /**
   * Where the ride's state comes from. Omitted in the app, where
   * `createRideSource` decides (ADR-0024: the live poll, or the simulation
   * under `VITE_SIMULATE_RIDE`).
   *
   * Injectable so tests can drive the full timeline — search, approach, trip,
   * fare — deterministically, without a driver on duty and without a fake
   * server. The alternative was reading an env flag inside the tests, which
   * would make what they exercise depend on how the suite was launched.
   */
  source?: RideSource
}) {
  const [state, setState] = useState<RideState>(INITIAL_RIDE_STATE)
  const [cancelOpen, setCancelOpen] = useState(false)
  /**
   * The destination's coordinates, geocoded here when the order form never
   * had them.
   *
   * A pickup or drop-off typed by hand — or arriving in the URL from the
   * landing page's hero form — is only ever a string; the form geocodes
   * just the places somebody picked out of the search list. Without a point
   * to head for there is no line to draw, so the trip screen showed a map
   * with no route on it at exactly the moment the route is the whole point.
   */
  const [resolvedTo, setResolvedTo] = useState<[number, number] | null>(null)

  useEffect(() => {
    if (to !== null || dropoff.trim() === '') return
    let cancelled = false
    void searchPlaces(dropoff).then((hits) => {
      const point = hits.find((hit) => hit.lngLat !== undefined)?.lngLat
      if (!cancelled && point !== undefined) setResolvedTo(point)
    })
    return () => {
      cancelled = true
    }
  }, [to, dropoff])

  const destination = to ?? resolvedTo
  /** Set once the fare is settled, which moves the screen on to rating. */
  const [paid, setPaid] = useState(false)
  const [rated, setRated] = useState(false)

  /**
   * One source per order, built once.
   *
   * `near` and the destination are deliberately not dependencies: both can
   * land a beat after the screen mounts, and rebuilding the source on
   * either would restart the ride from zero in front of somebody already
   * watching it. A destination geocoded later is pushed in through
   * `setDestination` instead, so the car still steers to it.
   */
  const [source] = useState(
    () => injectedSource ?? createRideSource(reference, near, destination),
  )

  // Told, not asked: a drop-off geocoded after the ride began still steers
  // the car, and the ride does not restart to learn it.
  useEffect(() => {
    source.setDestination(destination)
  }, [source, destination])

  useEffect(() => source.subscribe(setState), [source])

  const { phase, captain, progress, etaSeconds, estimate, fare, cancelledReason, cancellable } =
    state
  const copy = PRE_ASSIGNMENT_COPY[phase]

  /**
   * The map shows a captain only once somebody is actually coming or
   * carrying you. During the search there is nobody, and after the trip
   * the car is no longer yours to watch.
   */
  const showCaptain =
    phase === 'accepted' || phase === 'driver_en_route' || isOnJourney(phase)

  /** The assigned phases, where the captain card is the whole screen. */
  const assigned =
    captain !== null &&
    (phase === 'accepted' ||
      phase === 'driver_en_route' ||
      phase === 'driver_arrived' ||
      isOnJourney(phase))

  /** In the car: the map is the screen, the sheet is a strip. */
  const onTrip = isOnJourney(phase)
  const sheetFraction = onTrip ? SHEET_FRACTION_ON_TRIP : SHEET_FRACTION

  return (
    <div className="min-h-[100dvh] bg-surface-page text-text-body">
      <OrderNav desktopOnly cancelLabel="Close" />
      <div className="lg:grid lg:grid-cols-[minmax(0,34rem)_1fr]">
        {/* Order matters below lg: the map is fixed inset-0, so it must be
            painted before the sheet that floats over it. On lg the grid
            puts the sheet in column one regardless. */}
        <MapPanel
          pickup=""
          dropoff=""
          center={near}
          from={onTrip ? (from ?? near) : from}
          to={onTrip ? destination : to}
          matching
          searching={phase === 'searching' || phase === 'offered'}
          captainAt={showCaptain ? (captain?.lngLat ?? null) : null}
          captainKind={captain?.kind ?? 'sedan'}
          sheetFraction={sheetFraction}
        />

        <Link
          to="/"
          aria-label="Leave this order"
          className="fixed left-5 top-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-surface-card text-text-heading shadow-lg transition-transform duration-150 ease-[var(--kr-ease-out)] active:scale-95 lg:hidden"
        >
          <ArrowLeft className="h-6 w-6" aria-hidden />
        </Link>

        {/*
         * The sheet is the page's grey, not white, so the sections inside
         * read as separate cards stacked on it. One tall white panel put
         * the captain, the route and the fare in the same visual container,
         * which is three unrelated things wearing one box.
         */}
        <main
          style={{ '--kr-sheet': sheetFraction * 100 } as CSSProperties}
          className="kr-sheet fixed inset-x-0 bottom-0 z-30 max-h-[calc(var(--kr-sheet)*1dvh)] w-full space-y-3 overflow-y-auto rounded-t-3xl border-t border-border bg-surface-page px-3 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(0,16,40,0.16)] lg:static lg:z-auto lg:col-start-1 lg:row-start-1 lg:max-h-none lg:animate-none lg:overflow-visible lg:rounded-none lg:border-0 lg:px-6 lg:pb-20 lg:pt-8 lg:shadow-none lg:[transform:none]"
        >
          <div
            className="mx-auto mb-1 mt-3 h-1 w-10 rounded-full bg-border lg:hidden"
            aria-hidden
          />

          {/* Before a captain exists, the sheet leads with its own headline. */}
          {copy !== undefined && !rated && (
            <section className={CARD}>
              <h1 className="font-display text-2xl font-bold tracking-tight text-text-heading">
                {copy.title}
              </h1>
              <p className="mt-2 text-text-secondary" aria-live="polite">
                {copy.body}
              </p>
              {(phase === 'searching' || phase === 'offered') && (
                <>
                  <SearchRail phase={phase} progress={progress} />
                  <p className="mt-4 flex items-center gap-3 text-sm text-text-secondary">
                    <img
                      src={SIDE_SPRITES[captain?.kind ?? 'sedan']}
                      alt=""
                      width={56}
                      height={56}
                      className="kr-hunting h-10 w-12 shrink-0 object-contain"
                    />
                    Contacting captains nearby.
                  </p>
                </>
              )}
              {phase === 'cancelled' && cancelledReason !== null && (
                <p className="mt-2 text-sm text-text-secondary">Reason: {cancelledReason}</p>
              )}
            </section>
          )}

          {assigned && captain !== null && !onTrip && (
            <CaptainCard captain={captain} phase={phase} etaSeconds={etaSeconds} />
          )}

          {/* In the car the full card is spent; a strip is enough. The
              heading stays, carrying the one number still worth reading
              from the back seat. */}
          {onTrip && captain !== null && (
            <>
              <div className="flex items-baseline justify-between gap-3 px-1">
                <h1 className="font-display text-lg font-bold tracking-tight text-text-heading">
                  On your trip
                </h1>
                {etaSeconds !== null && etaSeconds > 0 && (
                  <p className="text-sm font-medium tabular-nums text-text-secondary">
                    {Math.max(1, Math.ceil(etaSeconds / 60))} min to go
                  </p>
                )}
              </div>
              <TripCaptainBanner captain={captain} />
            </>
          )}

          {/* The route is the customer's, so it stays visible whether the
              captain is on the way or already carrying them. */}
          {(assigned || phase === 'searching' || phase === 'offered') && !onTrip && (
            <DestinationCard pickup={pickup} dropoff={dropoff} />
          )}

          {assigned && !onTrip && estimate !== null && <PaymentCard fare={estimate} estimated />}

          {phase === 'trip_completed' && fare !== null && captain !== null && (
            <TripCompleted
              fare={fare}
              captain={captain}
              paid={paid}
              rated={rated}
              onPaid={() => setPaid(true)}
              onRated={() => setRated(true)}
            />
          )}

          {(phase === 'cancelled' || phase === 'unmatched') && (
            <Link
              to="/"
              className="block rounded-full bg-brand-green px-6 py-4 text-center font-semibold text-text-on-brand transition-[background-color,transform] duration-150 ease-[var(--kr-ease-out)] hover:bg-brand-green-hover hover:text-text-on-brand hover:no-underline active:scale-[0.98]"
            >
              Book another ride
            </Link>
          )}

          {/* Cancelling stays available for exactly as long as there is a
              ride to cancel, and disappears the moment there is not. Red,
              full width and unmissable: it is a decision, not a nudge.

              Two conditions, not one. `isCancellable(phase)` asks whether
              cancelling would make sense here; `cancellable` asks whether
              anything is behind the button. ADR-0024 defers customer
              cancellation by name — it carries a charge rule nobody has
              decided — so the live source answers false and the button is
              absent rather than inert. A control that appears to work and
              does nothing is the worse failure. */}
          {isCancellable(phase) && cancellable && (
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              className="w-full rounded-full bg-red-600 px-6 py-4 font-semibold text-white transition-[background-color,transform] duration-150 ease-[var(--kr-ease-out)] hover:bg-red-700 active:scale-[0.98]"
            >
              Cancel trip
            </button>
          )}

          <p className="pb-2 text-center text-sm text-text-secondary">
            Order reference{' '}
            <span className="font-mono font-semibold tracking-wider text-text-heading">
              {reference}
            </span>
          </p>
        </main>
      </div>

      {cancelOpen && (
        <CancelSheet
          onClose={() => setCancelOpen(false)}
          onConfirm={(reason) => {
            setCancelOpen(false)
            source.cancel(reason)
          }}
        />
      )}
    </div>
  )
}

/**
 * The captain, reduced to a strip for the trip itself.
 *
 * By this point the customer is in the car: they have already found it, so
 * the plate, the colour and the model have done their job and the full card
 * is just taking room the map wants. What is left is who is driving, a way
 * to reach them, and — the one new thing a trip makes possible — saying you
 * would ride with them again.
 */
function TripCaptainBanner({ captain }: { captain: Captain }) {
  const [favourite, setFavourite] = useState(() => isFavouriteCaptain(captain.plate))

  return (
    <section className="flex items-center gap-3 rounded-2xl border border-border bg-surface-card p-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-green-tint text-brand-green">
        <User className="h-6 w-6" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-text-heading">{captain.name}</span>
        <span className="flex items-center gap-1 text-sm text-text-secondary">
          <Star className="h-3 w-3 fill-current text-amber-500" aria-hidden />
          {captain.rating.toFixed(1)}
          <span aria-hidden>·</span>
          <span className="truncate">{captain.plate}</span>
        </span>
      </span>

      <button
        type="button"
        aria-pressed={favourite}
        aria-label={
          favourite ? `Remove ${captain.name} from favourites` : `Save ${captain.name} as a favourite`
        }
        onClick={() =>
          setFavourite(
            toggleFavouriteCaptain({
              name: captain.name,
              plate: captain.plate,
              vehicle: captain.vehicle,
              vehicleColour: captain.vehicleColour,
            }),
          )
        }
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-full transition-[background-color,color,transform] duration-150 ease-[var(--kr-ease-out)] active:scale-90 ${
          favourite ? 'bg-red-50 text-red-600 dark:bg-red-950' : 'bg-surface-sunken text-text-secondary'
        }`}
      >
        <Heart className={`h-5 w-5 ${favourite ? 'fill-current' : ''}`} aria-hidden />
      </button>

      {/* Kept deliberately, though it was not asked for: losing the ability
          to reach your driver while you are in their car is a safety
          regression, not a tidy-up. */}
      <a
        href={`tel:${captain.phone}`}
        aria-label="Contact Captain"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface-sunken text-text-heading transition-transform duration-150 ease-[var(--kr-ease-out)] hover:no-underline active:scale-90"
      >
        <Phone className="h-5 w-5" aria-hidden />
      </a>
    </section>
  )
}

/**
 * Who is coming, what they are driving, and the three ways to reach them.
 * The plate gets its own pill because it is the thing you actually match
 * against the car pulling up.
 */
function CaptainCard({
  captain,
  phase,
  etaSeconds,
}: {
  captain: Captain
  phase: RidePhase
  etaSeconds: number | null
}) {
  const [shareNote, setShareNote] = useState<string | null>(null)

  const share = () => {
    const text = `I'm on a KangaruRide with ${captain.name}, ${captain.vehicleColour} ${captain.vehicle}, plate ${captain.plate}.`
    // The Web Share API where it exists, the clipboard where it does not.
    // Both are real; neither pretends to be live trip tracking, which does
    // not exist yet.
    if (typeof navigator.share === 'function') {
      void navigator.share({ title: 'My KangaruRide trip', text }).catch(() => {})
      return
    }
    void navigator.clipboard?.writeText(text).then(
      () => setShareNote('Trip details copied.'),
      () => setShareNote('Could not copy the trip details.'),
    )
  }

  return (
    <section className={CARD}>
      <div className="flex items-center justify-between gap-3">
        {/* `tabular-nums` so the minute digit does not change the line's
            width as it counts down and nudge the whole heading about. */}
        <h1 className="font-display text-lg font-bold leading-snug tracking-tight tabular-nums text-text-heading">
          {captainHeadline(phase, captain, etaSeconds)}
        </h1>
        <button
          type="button"
          onClick={share}
          aria-label="Share your trip"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-sunken text-text-heading transition-[background-color,transform] duration-150 ease-[var(--kr-ease-out)] hover:bg-border active:scale-95"
        >
          <Share2 className="h-[18px] w-[18px]" aria-hidden />
        </button>
      </div>
      {shareNote !== null && (
        <p role="status" className="mt-2 text-sm text-brand-green">
          {shareNote}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm text-text-secondary">
          {captain.vehicle}, {captain.vehicleColour}
        </p>
        <span className="shrink-0 rounded-lg bg-surface-sunken px-3 py-1.5 font-display text-base font-bold tracking-wide text-text-heading">
          {captain.plate}
        </span>
      </div>

      <div className="mt-4 h-px bg-border" />

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="flex flex-col items-center gap-2">
          {/* An icon rather than a photo: no captain photographs exist, and
              a stock face would be a stranger's picture on a real trip. */}
          <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-green-tint text-brand-green">
            <User className="h-6 w-6" aria-hidden />
          </span>
          <span className="flex items-center gap-1 text-center text-xs font-semibold text-text-heading">
            {captain.name.split(' ')[0]}
            <Star className="h-3 w-3 fill-current text-amber-500" aria-hidden />
            <span className="font-normal text-text-secondary">{captain.rating.toFixed(1)}</span>
          </span>
        </div>

        <CaptainAction
          href={`tel:${captain.phone}`}
          icon={<Phone className="h-5 w-5" aria-hidden />}
          label="Contact Captain"
        />
        <CaptainAction
          href={`sms:${captain.phone}`}
          icon={<MessageCircle className="h-5 w-5" aria-hidden />}
          label="Message Captain"
        />
      </div>
    </section>
  )
}

/** A round icon over its label — the phone and message affordances. */
function CaptainAction({
  href,
  icon,
  label,
}: {
  href: string
  icon: React.ReactNode
  label: string
}) {
  return (
    <a
      href={href}
      className="flex flex-col items-center gap-2 text-text-heading transition-transform duration-150 ease-[var(--kr-ease-out)] hover:no-underline active:scale-95"
    >
      <span className="grid h-12 w-12 place-items-center rounded-full bg-surface-sunken">
        {icon}
      </span>
      <span className="text-center text-xs font-semibold leading-tight">{label}</span>
    </a>
  )
}

/**
 * The trip as a route: where you are being collected, any stop between, and
 * where you are going.
 */
function DestinationCard({ pickup, dropoff }: { pickup: string; dropoff: string }) {
  const [note, setNote] = useState<string | null>(null)

  /*
   * Adding a stop and editing a destination both change a trip that is
   * already dispatched, which needs a backend that can re-price and tell
   * the captain. Neither exists, so these say so rather than appearing to
   * work — a route edit that silently does nothing is worse than one that
   * is honestly unavailable.
   */
  const unavailable = () => setNote('Changing the route mid-trip is not available yet.')

  return (
    <section className={CARD}>
      <h2 className="font-display text-xl font-bold text-text-heading">My destination</h2>

      <ol className="mt-4">
        {/* The connectors are coloured per leg — green out of the pickup,
            amber into the destination — so the route reads as one line
            travelled rather than three unrelated pins. A hairline in the
            border grey disappeared against the card entirely. */}
        <li className="flex gap-3">
          <span className="flex flex-col items-center self-stretch" aria-hidden>
            <span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-green">
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
            </span>
            <span className="w-0.5 flex-1 bg-brand-green" />
          </span>
          <span className="min-w-0 flex-1 pb-4 font-medium text-text-heading">
            {pickup || 'Your pickup'}
          </span>
        </li>

        <li className="flex gap-3">
          <span className="flex flex-col items-center self-stretch" aria-hidden>
            <MapPin className="h-5 w-5 shrink-0 text-blue-600" />
            <span className="w-0.5 flex-1 bg-amber-400/60" />
          </span>
          <button
            type="button"
            onClick={unavailable}
            className="min-w-0 flex-1 pb-4 text-left text-text-placeholder transition-colors duration-150 hover:text-text-secondary"
          >
            Add stop
          </button>
        </li>

        <li className="flex items-start gap-3">
          <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden />
          <span className="min-w-0 flex-1 font-medium text-blue-700 dark:text-blue-400">
            {dropoff || 'Your destination'}
          </span>
          <button
            type="button"
            onClick={unavailable}
            aria-label="Edit destination"
            className="shrink-0 rounded p-1 text-text-secondary transition-colors duration-150 hover:text-text-heading"
          >
            <Pencil className="h-5 w-5" aria-hidden />
          </button>
        </li>
      </ol>

      <div className="mt-4 h-px bg-border" />

      <button
        type="button"
        onClick={unavailable}
        className="mt-4 flex items-center gap-2 font-semibold text-brand-green transition-colors duration-150 hover:text-brand-green-hover"
      >
        <Target className="h-5 w-5" aria-hidden />
        Edit destinations
      </button>

      {note !== null && (
        <p role="status" className="mt-3 text-sm text-text-secondary">
          {note}
        </p>
      )}
    </section>
  )
}

/** What it will cost, and how it is being settled. */
function PaymentCard({ fare, estimated = false }: { fare: Fare; estimated?: boolean }) {
  return (
    <section className={CARD}>
      <h2 className="font-display text-xl font-bold text-text-heading">Payment method</h2>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-brand-green text-white">
            <Banknote className="h-5 w-5" aria-hidden />
          </span>
          <span className="font-medium text-text-heading">Cash</span>
        </span>
        <span className="font-semibold tabular-nums text-text-heading">
          {formatUgx(fare.total)}
        </span>
      </div>
      {estimated && (
        // The quote is not the bill. Saying so up front is the difference
        // between a fare that "went up" and one that was always a range.
        <p className="mt-2 text-xs text-text-secondary">
          Estimated. The final fare follows the distance and time actually travelled.
        </p>
      )}
    </section>
  )
}

/**
 * The progress rail. Determinate while searching, because there is a real
 * timeout being counted down; indeterminate during an offer, because the
 * wait is on a person tapping accept and no honest number exists for that.
 */
function SearchRail({ phase, progress }: { phase: RidePhase; progress: number }) {
  const percent = Math.round(progress * 100)

  return (
    <div
      className="relative mt-4 h-2 w-full rounded-full bg-surface-sunken"
      role="progressbar"
      aria-label="Matching progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={phase === 'offered' ? undefined : percent}
    >
      <div
        className={`h-full rounded-full bg-brand-green transition-[width] duration-300 ease-[var(--kr-ease-out)] ${
          phase === 'offered' ? 'kr-rail-pulse' : ''
        }`}
        style={{ width: `${Math.max(percent, 4)}%` }}
      />
      <span
        className="absolute -right-0.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-brand-green"
        aria-hidden
      />
    </div>
  )
}

/** The fare, then payment, then the rating — in that order. */
function TripCompleted({
  fare,
  captain,
  paid,
  rated,
  onPaid,
  onRated,
}: {
  fare: Fare
  captain: Captain
  paid: boolean
  rated: boolean
  onPaid: () => void
  onRated: () => void
}) {
  const [method, setMethod] = useState('cash')
  const [stars, setStars] = useState(0)

  if (rated) {
    return (
      <section className={`${CARD} text-center`}>
        <CheckCircle2 className="mx-auto h-10 w-10 text-brand-green" aria-hidden />
        <p className="mt-3 font-semibold text-text-heading">{formatUgx(fare.total)} settled</p>
        <p className="mt-1 text-sm text-text-secondary">
          You rated {captain.name.split(' ')[0]} {stars} stars.
        </p>
        <Link
          to="/"
          className="mt-5 block rounded-full bg-brand-green px-6 py-4 font-semibold text-text-on-brand transition-[background-color,transform] duration-150 ease-[var(--kr-ease-out)] hover:bg-brand-green-hover hover:text-text-on-brand hover:no-underline active:scale-[0.98]"
        >
          Book another ride
        </Link>
      </section>
    )
  }

  if (paid) {
    return (
      <section className={CARD}>
        <p className="font-semibold text-text-heading">
          How was your trip with {captain.name.split(' ')[0]}?
        </p>
        <div className="mt-4 flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setStars(n)}
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
              aria-pressed={stars === n}
              className="rounded-full p-1 transition-transform duration-150 ease-[var(--kr-ease-out)] active:scale-90"
            >
              <Star
                className={`h-9 w-9 ${n <= stars ? 'fill-current text-amber-500' : 'text-border'}`}
                aria-hidden
              />
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={stars === 0}
          onClick={onRated}
          className="mt-5 w-full rounded-full bg-brand-green px-6 py-4 font-semibold text-text-on-brand transition-[background-color,transform,opacity] duration-150 ease-[var(--kr-ease-out)] hover:bg-brand-green-hover active:scale-[0.98] disabled:opacity-50"
        >
          Submit rating
        </button>
      </section>
    )
  }

  return (
    <section className={CARD}>
      <p className="text-center font-display text-4xl font-bold text-text-heading">
        {formatUgx(fare.total)}
      </p>
      <dl className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
        <FareRow label="Base fare" value={formatUgx(fare.base)} />
        <FareRow label={`Distance · ${fare.distanceKm} km`} value={formatUgx(fare.distance)} />
        <FareRow label={`Time · ${fare.minutes} mins`} value={formatUgx(fare.time)} />
      </dl>

      <p className="mt-5 font-semibold text-text-heading">Pay with</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {[
          { id: 'cash', label: 'Cash' },
          { id: 'mtn', label: 'MTN MoMo' },
          { id: 'airtel', label: 'Airtel' },
        ].map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={method === option.id}
            onClick={() => setMethod(option.id)}
            className={`rounded-lg border px-3 py-3 text-sm font-semibold transition-[border-color,background-color,transform] duration-150 ease-[var(--kr-ease-out)] active:scale-[0.98] ${
              method === option.id
                ? 'border-brand-green bg-surface-accent text-brand-green'
                : 'border-border text-text-secondary'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {/* Nothing is charged here. ADR-0014 shipped credential slots for the
          payment providers but no integration, so this records how the
          customer intends to settle and hands them a receipt — it must not
          look like a checkout that took money. */}
      <p className="mt-2 text-xs text-text-secondary">
        {method === 'cash'
          ? 'Pay your captain directly when you get out.'
          : 'You will get a prompt on your phone to approve the payment.'}
      </p>
      <button
        type="button"
        onClick={onPaid}
        className="mt-4 w-full rounded-full bg-brand-green px-6 py-4 font-semibold text-text-on-brand transition-[background-color,transform] duration-150 ease-[var(--kr-ease-out)] hover:bg-brand-green-hover active:scale-[0.98]"
      >
        {method === 'cash' ? 'I have paid' : 'Confirm payment'}
      </button>
    </section>
  )
}

function FareRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="font-medium tabular-nums text-text-heading">{value}</dd>
    </div>
  )
}

/** Cancelling asks why, because "why" is the only thing dispatch can learn from. */
function CancelSheet({
  onClose,
  onConfirm,
}: {
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 lg:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Cancel this trip"
      onClick={onClose}
    >
      <div
        className="kr-sheet w-full rounded-t-3xl bg-surface-card px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-6 shadow-2xl lg:max-w-md lg:rounded-3xl lg:pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl font-bold text-text-heading">Cancel this trip?</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Tell us why, so we can send a better captain next time.
        </p>
        <div className="mt-4 space-y-2">
          {CANCEL_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              onClick={() => onConfirm(reason)}
              className="w-full rounded-lg border border-border px-4 py-3 text-left font-medium text-text-heading transition-[background-color,border-color,transform] duration-150 ease-[var(--kr-ease-out)] hover:border-brand-green hover:bg-surface-accent active:scale-[0.99]"
            >
              {reason}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-lg px-6 py-3 font-semibold text-text-secondary transition-colors duration-150 hover:text-text-heading"
        >
          Keep my trip
        </button>
      </div>
    </div>
  )
}
