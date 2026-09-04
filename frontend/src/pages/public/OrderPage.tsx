import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Armchair,
  ArrowLeft,
  ArrowRight,
  Car,
  CircleEllipsis,
  FileText,
  Smartphone,
  UtensilsCrossed,
  WashingMachine,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Eye,
  EyeOff,
  History,
  KeyRound,
  LocateFixed,
  Mail,
  MapPin,
  Package,
  Pencil,
  Phone,
  Search,
  User,
  Users,
  Weight,
} from 'lucide-react'
import { isAxiosError } from 'axios'
import { useCustomer } from '../../auth/useCustomer'
import {
  passwordStrength,
  MIN_PASSWORD_LENGTH,
  STRENGTH_SEGMENTS,
} from '../../auth/passwordStrength'
import {
  CustomerValidationError,
  GENDER_OPTIONS,
  loginCustomer,
  registerCustomer,
  type Customer as CustomerAccount,
  type CustomerGender as CustomerGenderValue,
} from '../../auth/customerAuth'
import {
  SERVICE_META,
  fetchFareQuotes,
  submitPublicOrder,
  type FareQuote,
  type PublicOrderPayload,
  type PublicService,
  type RideClass,
} from './publicOrder'
import {
  currentLocationPlace,
  geolocationRefused,
  placeLabel,
  recentDestinations,
  rememberDestination,
  reverseGeocode,
  searchPlaces,
  type PlaceHit,
} from './places'
import {
  dropoffCoordinates,
  pickupCoordinates,
  withCoordinateErrorsOnTheirFields,
  withGeocodedEnds,
} from './orderCoordinates'
import { usePlaceSearch } from '../../lib/usePlaceSearch'
import { DateRangePicker } from './DateRangePicker'
import { DeliverySummary, type Payer } from './DeliverySummary'
import { PaymentMethodField, type PaymentMethod } from './PaymentMethodField'
import { DeliveryParties } from './DeliveryParties'
import { EMPTY_PARTY, type Party } from './party'
import { KycVerification } from './KycVerification'
import { RENTAL_KYC, type KycFiles } from './kycDocuments'
import { PrivacyLine } from './PrivacyNoticePage'
import { tripEstimate } from './tripEstimate'
import { MapPanel } from './MapPanel'
import { mergeFleet, NEARBY_POLL_MS, type FleetSprite } from './nearbyVehicles'
import { apiClient } from '../../lib/apiClient'
import type { ApiSuccess } from '../../types/api'
import type { NearbyVehicle } from '../../types/livePosition'
import { formatUgx } from './ride'
import { RideScreen } from './RideScreen'
import { OrderNav } from './OrderNav'
import './landing.css'

/** Kampala city centre, lng-first — the map's own opening point. */
const KAMPALA_CENTRE: [number, number] = [32.5825, 0.3476]

type Step = 'service' | 'details' | 'vehicle' | 'account' | 'review' | 'parties' | 'kyc'

/**
 * The vehicle IS the product. Delivery leads with it (the size defaults and
 * is changeable right there); rides and rentals need the trip or the dates
 * first, so their vehicle step follows the details.
 *
 * `account` disappears entirely for a customer who is already signed in
 * (ADR-0015 §3). Their name, phone and email are on the account; asking
 * again would be the form admitting it does not remember them.
 */
function stepsFor(service: PublicService, signedIn: boolean): Step[] {
  const upToVehicle: Step[] =
    service === 'delivery' ? ['service', 'vehicle', 'details'] : ['service', 'details', 'vehicle']

  /*
   * A ride has no confirm screen. Picking the car IS the confirmation —
   * the trip and the vehicle are both on the screen you tapped it from,
   * and a summary that repeats them is a page standing between somebody
   * and a taxi they have already described.
   *
   * Delivery and self-drive keep theirs: a parcel's size and contents, or
   * a rental's dates, are worth reading back before they are committed to.
   *
   * A parcel then asks one more thing nothing else needs: who is at each
   * end of it. A rider arriving at a gate has to ask for somebody by name,
   * and the account only names the person who booked.
   */
  const confirm: Step[] =
    service === 'ride' ? [] : service === 'delivery' ? ['review', 'parties'] : ['review']

  /*
   * A rental hands somebody a vehicle and lets them drive away in it, which
   * makes it the one order on this page that has to know who they are. It
   * follows the vehicle directly for a customer already signed in; signed
   * out it waits for the account, because documents belonging to nobody are
   * documents with nowhere to hang.
   */
  const identity: Step[] = service === 'self_drive' ? ['kyc'] : []

  return signedIn
    ? [...upToVehicle, ...identity, ...confirm]
    : [...upToVehicle, 'account', ...identity, ...confirm]
}

/**
 * The ride classes on offer, with the same starting fares the landing page
 * advertises. No live ETAs or discounts: the dispatcher quotes the real
 * price on the confirmation call.
 */
const RIDE_CLASSES = [
  { value: 'economy', label: 'Economy', seats: 4, fare: 'UGX 12,500', sprite: 'side-economy' },
  { value: 'standard', label: 'Standard', seats: 4, fare: 'UGX 16,500', sprite: 'side-standard' },
  { value: 'xl', label: 'XL', seats: 6, fare: 'UGX 22,000', sprite: 'side-xl' },
  { value: 'boda', label: 'Boda Boda', seats: 1, fare: 'UGX 5,000', sprite: 'side-boda' },
  {
    value: 'electric_boda',
    label: 'Electric Boda',
    seats: 1,
    fare: 'UGX 6,000',
    sprite: 'side-electric-boda',
  },
]

/**
 * Delivery is vehicle-first: instead of interrogating the sender about the
 * item, the package size recommends a vehicle and the price says the rest.
 */
const DELIVERY_FLEET: {
  id: string
  name: string
  blurb: string
  fare: string
  sprite: string
  forSize: string
}[] = [
  {
    id: 'boda',
    name: 'Boda Boda',
    blurb: 'Best for small items & documents',
    fare: 'UGX 5,000',
    sprite: 'side-boda',
    forSize: 'small',
  },
  {
    id: 'tricycle',
    name: 'Tricycle',
    blurb: 'For medium packages',
    fare: 'UGX 9,000',
    sprite: 'side-tricycle',
    forSize: 'medium',
  },
  {
    id: 'pickup',
    name: 'Pickup',
    blurb: 'For large packages',
    fare: 'UGX 18,000',
    sprite: 'side-pickup',
    forSize: 'large',
  },
  {
    id: '5ton',
    name: '5 Ton',
    blurb: 'For heavy cargo',
    fare: 'UGX 65,000',
    sprite: 'side-truck',
    forSize: 'heavy',
  },
  {
    id: '10ton',
    name: '10 Ton',
    blurb: 'For very heavy cargo',
    fare: 'UGX 110,000',
    sprite: 'side-truck',
    forSize: '',
  },
]

/** "What are you sending?" — the API's item_type values, given faces. */
const ITEM_TYPES: { value: string; label: string; icon: React.ReactNode }[] = [
  { value: 'documents', label: 'Documents', icon: <FileText className="h-6 w-6" aria-hidden /> },
  { value: 'food', label: 'Food', icon: <UtensilsCrossed className="h-6 w-6" aria-hidden /> },
  { value: 'parcel', label: 'Parcel', icon: <Package className="h-6 w-6" aria-hidden /> },
  {
    value: 'electronics',
    label: 'Electronics',
    icon: <Smartphone className="h-6 w-6" aria-hidden />,
  },
  { value: 'furniture', label: 'Furniture', icon: <Armchair className="h-6 w-6" aria-hidden /> },
  {
    value: 'appliances',
    label: 'Appliances',
    icon: <WashingMachine className="h-6 w-6" aria-hidden />,
  },
  { value: 'other', label: 'Other', icon: <CircleEllipsis className="h-6 w-6" aria-hidden /> },
]

const PACKAGE_SIZES = [
  { value: 'small', label: 'Small (under 5 kg)' },
  { value: 'medium', label: 'Medium (5 to 20 kg)' },
  { value: 'large', label: 'Large (over 20 kg)' },
  { value: 'heavy', label: 'Heavy cargo' },
]

type RentalCategory = 'sedan' | 'suv' | 'van' | 'pickup'

/**
 * The self-drive catalogue. A hand-kept list for now - the public API has no
 * fleet endpoint - with indicative day rates; the dispatcher confirms
 * availability and the final rate on the call.
 */
const SELF_DRIVE_FLEET: {
  id: string
  name: string
  category: RentalCategory
  transmission: string
  seats: number
  rate: string
  sprite: string
}[] = [
  {
    id: 'premio',
    name: 'Toyota Premio',
    category: 'sedan',
    transmission: 'Automatic',
    seats: 5,
    rate: 'UGX 180,000',
    sprite: 'side-economy',
  },
  {
    id: 'allion',
    name: 'Toyota Allion',
    category: 'sedan',
    transmission: 'Automatic',
    seats: 5,
    rate: 'UGX 160,000',
    sprite: 'side-economy',
  },
  {
    id: 'forester',
    name: 'Subaru Forester',
    category: 'suv',
    transmission: 'Automatic',
    seats: 5,
    rate: 'UGX 250,000',
    sprite: 'side-standard',
  },
  {
    id: 'rav4',
    name: 'Toyota RAV4',
    category: 'suv',
    transmission: 'Automatic',
    seats: 5,
    rate: 'UGX 230,000',
    sprite: 'side-standard',
  },
  {
    id: 'noah',
    name: 'Toyota Noah',
    category: 'van',
    transmission: 'Automatic',
    seats: 8,
    rate: 'UGX 280,000',
    sprite: 'side-xl',
  },
  {
    id: 'hiace',
    name: 'Toyota Hiace',
    category: 'van',
    transmission: 'Manual',
    seats: 14,
    rate: 'UGX 350,000',
    sprite: 'side-xl',
  },
  {
    id: 'hilux',
    name: 'Toyota Hilux',
    category: 'pickup',
    transmission: 'Manual',
    seats: 5,
    rate: 'UGX 400,000',
    sprite: 'side-pickup',
  },
]

const RENTAL_FILTERS: { value: RentalCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'sedan', label: 'Sedan' },
  { value: 'suv', label: 'SUV' },
  { value: 'van', label: 'Vans' },
  { value: 'pickup', label: 'Pickup' },
]

/**
 * The visitor order flow (ADR-0012 §5): service, details, contact, review,
 * then the reference the dispatcher will quote back. State lives here and
 * flows down; the only network call is the final submit.
 */

export function OrderPage() {
  const [params] = useSearchParams()
  /*
   * The customer account, not the staff session (ADR-0015 §1). A
   * dispatcher signed into the back office is not the person being driven
   * anywhere; if they want a walk-in order the tray at /order-requests is
   * theirs. This page answers to the `customer` guard alone.
   */
  const { customer, loading: sessionLoading, adopt } = useCustomer()

  const initialService = ((): PublicService => {
    const fromUrl = params.get('service')
    return fromUrl === 'delivery' || fromUrl === 'self_drive' ? fromUrl : 'ride'
  })()

  const [requestedStep, setStep] = useState<Step>(() => {
    const fromUrl = params.get('service')
    if (fromUrl === 'delivery') return 'vehicle'
    return fromUrl ? 'details' : 'service'
  })
  const [service, setService] = useState<PublicService>(initialService)
  const [pickup, setPickup] = useState(params.get('pickup') ?? '')
  const [dropoff, setDropoff] = useState(params.get('dropoff') ?? '')
  // The geocoder's two-line form of the same place ("Acacia Mall" /
  // "14-18 Cooper Rd, Kampala"), kept alongside the plain string the
  // payload sends. Null when the visitor typed free text.
  const [pickupPlace, setPickupPlace] = useState<PlaceHit | null>(null)
  const [dropoffPlace, setDropoffPlace] = useState<PlaceHit | null>(null)
  /** Where the device says we are, so the map can show those surroundings. */
  const [myPosition, setMyPosition] = useState<[number, number] | null>(null)
  /** Both ends geocoded: the map is drawing the trip, so make room for it. */
  const tripFrom = pickupPlace?.lngLat ?? null
  const tripTo = dropoffPlace?.lngLat ?? null

  /*
   * The tariff's price per ride class, once both ends are placed.
   *
   * The card beside each class used to show a literal — "from UGX 12,500" —
   * while the rate card sat unasked on the server until a vehicle had
   * accepted; the passenger chose against numbers no tariff had produced and
   * the driver was then quoted a different figure for the same ride. Now the
   * form asks `GET /public/fare-quotes` the moment it knows both points, and
   * shows the estimate; the literal survives only as the fallback for a class
   * the tariff does not price, and is labelled "from" so the two never read as
   * the same claim. Re-asked only when a point moves — not on every render.
   */
  const quoteKey =
    tripFrom !== null && tripTo !== null ? `${tripFrom.join(',')}|${tripTo.join(',')}` : null
  // Stored with the pair it answers, so a quote for the *previous* pair is
  // never shown against a new one while the fetch is in flight — and so the
  // effect never has to reset state synchronously to clear it.
  const [fetchedQuotes, setFetchedQuotes] = useState<{
    key: string
    quotes: Record<RideClass, FareQuote | null>
  } | null>(null)
  const fareQuotes = fetchedQuotes !== null && fetchedQuotes.key === quoteKey ? fetchedQuotes.quotes : null
  useEffect(() => {
    if (quoteKey === null || tripFrom === null || tripTo === null) return
    const controller = new AbortController()
    fetchFareQuotes(tripFrom, tripTo, controller.signal)
      .then((quotes) => setFetchedQuotes({ key: quoteKey, quotes }))
      // A quote that could not be fetched is no quote: the "from" figure
      // stands, honestly labelled. Never a spinner over a form.
      .catch(() => undefined)
    return () => controller.abort()
    // `quoteKey` is the pair, stringified; the two arrays are new objects on
    // every render and would refetch on each.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey])
  // Self drive has no trip to draw: it is a rental, not a journey.
  const tripVisualised = service !== 'self_drive' && tripFrom !== null && tripTo !== null

  /*
   * The real vehicles nearby (GET /public/nearby-vehicles) — the live data
   * behind the map's ambient fleet, which used to be six sprites at
   * hardcoded offsets. Polled every NEARBY_POLL_MS while the fleet is
   * actually on screen: not once a route is drawn (the panel stands the
   * fleet down then, and asking for what will not be shown is spend for
   * nothing) and not while the tab is hidden.
   *
   * Centred on the pickup if one is placed, else the device fix, else the
   * city — the map's own opening framing, in the same order.
   */
  const [fleet, setFleet] = useState<FleetSprite[]>([])
  const fleetCentre = useRef<[number, number]>(KAMPALA_CENTRE)
  // Written in an effect, not during render — a render-time ref write is
  // exactly what the React Compiler rules exist to catch.
  useEffect(() => {
    fleetCentre.current = tripFrom ?? myPosition ?? KAMPALA_CENTRE
  }, [tripFrom, myPosition])
  useEffect(() => {
    if (tripVisualised) return

    let live = true
    let timer: ReturnType<typeof setInterval> | undefined

    const load = () => {
      const [lng, lat] = fleetCentre.current
      // `Promise.resolve` around the call and optional chaining on the
      // envelope: this is an ambient layer on an unauthenticated endpoint,
      // and anything unexpected — a proxy error page, a surprising mock, a
      // client that returned nothing — must degrade to "no vehicles",
      // never to a crash in a polling loop.
      Promise.resolve(
        apiClient.get<ApiSuccess<NearbyVehicle[]>>(
          `/public/nearby-vehicles?latitude=${lat}&longitude=${lng}`,
        ),
      )
        .then((response) => {
          if (!live) return
          const vehicles = response?.data?.data
          if (!Array.isArray(vehicles)) return
          setFleet((previous) => mergeFleet(previous, vehicles))
        })
        // An ambient layer never surfaces an error: a poll that failed
        // simply leaves the last honest answer standing until the next.
        .catch(() => undefined)
    }

    const start = () => {
      load()
      timer = setInterval(load, NEARBY_POLL_MS)
    }
    const stop = () => {
      clearInterval(timer)
      timer = undefined
    }
    const onVisibility = () => {
      stop()
      if (document.visibilityState === 'visible') start()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      live = false
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [tripVisualised])
  const [rideFor, setRideFor] = useState<'myself' | 'other'>('myself')
  const [riderName, setRiderName] = useState('')
  const [riderPhone, setRiderPhone] = useState('')
  const [vehicleClass, setVehicleClass] = useState('economy')
  const [packageSize, setPackageSize] = useState('medium')
  const [itemType, setItemType] = useState('parcel')
  const [sizeOpen, setSizeOpen] = useState(false)
  const [deliveryVehicle, setDeliveryVehicle] = useState<string | null>(null)
  // The recommendation IS the selection until the sender overrides it, so
  // walking straight onto the vehicle screen still has a sensible pick.
  const effectiveDeliveryVehicle =
    deliveryVehicle ?? DELIVERY_FLEET.find((v) => v.forSize === packageSize)?.id ?? null
  // Who settles the bill, and on which rail. Delivery only: a ride is paid
  // by whoever is in the car, a rental by whoever signs for it.
  const [payer, setPayer] = useState<Payer>('sender')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  // The two ends of a parcel as people. The account holder is the sender by
  // default and the receiver is somebody new, which is the ordinary case.
  const [sender, setSender] = useState<Party>({ ...EMPTY_PARTY, isMe: true })
  const [receiver, setReceiver] = useState<Party>(EMPTY_PARTY)
  const [pinRequired, setPinRequired] = useState(true)
  const [rentalModel, setRentalModel] = useState<string | null>(null)
  /** The rental's identity checks, by document id. See `KycVerification`. */
  const [kycFiles, setKycFiles] = useState<KycFiles>({})
  const [rentalFilter, setRentalFilter] = useState<RentalCategory | 'all'>('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [notes, setNotes] = useState('')
  const [honeypot, setHoneypot] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [reference, setReference] = useState<string | null>(null)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)

  /*
   * Derived, not corrected in an effect. A stored session resolves after
   * first paint, so somebody can be standing on `account` at the moment
   * their account arrives — and `steps` has already dropped that step by
   * then, which blanks the progress rail as well. Deriving moves them in
   * the same render the session lands in; an effect would do it one
   * render later, and that render is a visible flash of a sign-up form
   * the customer does not need.
   */
  /*
   * ...and it doubles as the failure landing for a ride. A hail submits
   * straight from sign-up, so if the write is rejected there is no screen
   * left to be on — the sign-up already succeeded and re-showing it would
   * ask somebody to create the account they just created. Falling through
   * to the summary shows the error over everything they chose, with one
   * button to try again.
   *
   * `!submitting` is what keeps that fallback from firing *during* a
   * successful hail. Without it the confirm screen flashes up for the
   * length of the POST — the account lands, the step derives to `review`,
   * and the customer sees for half a second the exact screen a ride is
   * supposed not to have.
   */
  const step: Step =
    customer !== null && requestedStep === 'account' && !submitting ? 'review' : requestedStep

  const steps = stepsFor(service, customer !== null)
  const stepIndex = steps.indexOf(step)

  /**
   * What follows the vehicle/details pair: sign up, the rental's identity
   * checks, or straight to the confirm screen.
   */
  const afterChoices: Step =
    customer === null ? 'account' : service === 'self_drive' ? 'kyc' : 'review'

  /**
   * What the last choice step does. Signed out, everything goes to sign-up
   * first. Signed in, a ride places itself and everything else confirms.
   */
  const finishChoices = () => {
    if (customer === null) {
      setStep('account')
      return
    }
    if (service === 'ride') {
      void submit(customer)
      return
    }
    setStep('review')
  }

  /**
   * Most orders start where the person is standing, so an empty pickup
   * fills itself in from the device once per visit. Deliberately narrow:
   * it never overwrites a pickup that came from the URL or a previous
   * screen, it skips entirely when the browser has already refused, and a
   * refusal or timeout just leaves the field empty to type into.
   */
  const askedForLocation = useRef(false)
  useEffect(() => {
    if (askedForLocation.current || pickup.trim() !== '') return
    askedForLocation.current = true
    void geolocationRefused().then((refused) => {
      if (refused) return
      void currentLocationPlace().then((place) => {
        if (place === null) return
        // The payload carries the address; "Current location" is the label.
        setPickup(place.detail)
        setPickupPlace(place)
        if (place.lngLat !== undefined) setMyPosition(place.lngLat)
      })
    })
  }, [pickup])

  // Picking a vehicle happens mid-list, with Continue often below the fold;
  // bring it into view so the next tap is obvious.
  /*
   * The sheet is one scrolling element reused by every step, so its scroll
   * offset survives a step change — and `revealContinue` below deliberately
   * scrolls it. A tall step arriving after that opened part-scrolled, with
   * its heading sliced by the sheet's own top edge and the progress rail
   * out of sight above it. Every step starts at its own beginning.
   */
  const sheetRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const sheet = sheetRef.current
    // jsdom implements no scrolling at all, same as scrollIntoView below.
    if (sheet !== null && typeof sheet.scrollTo === 'function') sheet.scrollTo({ top: 0 })
  }, [step])

  const continueRef = useRef<HTMLDivElement>(null)
  const revealContinue = () => {
    requestAnimationFrame(() => {
      const el = continueRef.current
      if (el !== null && typeof el.scrollIntoView === 'function') {
        const reduceMotion =
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches
        el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' })
      }
    })
  }

  const detailsValid = useMemo(() => {
    if (service === 'self_drive') return startDate !== '' && endDate !== ''
    const trip = pickup.trim() !== '' && dropoff.trim() !== ''
    // A ride for someone else needs the rider reachable by the dispatcher.
    if (service === 'ride' && rideFor === 'other') {
      return trip && riderName.trim() !== '' && riderPhone.trim().length >= 9
    }
    return trip
  }, [service, pickup, dropoff, startDate, endDate, rideFor, riderName, riderPhone])

  /*
   * Ordering requires an account (ADR-0015 §1), so the contact details on
   * the order are the account's — read straight off it rather than copied
   * into form state, which is what keeps them from drifting apart after a
   * profile edit.
   */

  /*
   * The account is passed in rather than read from `customer` state. A ride
   * submits the instant sign-up succeeds, and at that moment `adopt()` has
   * been called but React has not re-rendered — reading state here would
   * send an order with an empty name and phone, which the server would
   * reject with a 422 the customer cannot act on.
   */
  const buildPayload = (account: CustomerAccount): PublicOrderPayload => {
    // `boolean` included because `confirm_with_pin` is one. Without it this
    // line has failed `tsc -b` since the delivery PIN shipped — the CI type
    // gate could not pass, and nobody saw it because CI has not been able to
    // run. `publicOrder.ts`'s own payload type already allowed booleans; it
    // was only this local narrowing that did not.
    const details: Record<string, string | number | boolean> = {}
    if (service === 'ride') {
      // The dispatcher settles the headcount on the phone.
      details.passengers = 1
      details.vehicle_class = vehicleClass
      // How the passenger will pay, so the driver knows before the kerb.
      // Rides sent nothing here for as long as the form existed, and the
      // driver app showed "Payment" over an empty cell on every one.
      details.payment_method = paymentMethod
      // A ride for someone else: the rider is the recipient of the service,
      // so it rides on the same validated details keys delivery uses.
      if (rideFor === 'other') {
        if (riderName.trim()) details.recipient_name = riderName.trim()
        if (riderPhone.trim()) details.recipient_phone = riderPhone.trim()
      }
    }
    if (service === 'delivery') {
      details.package_size = packageSize
      details.item_type = itemType
      const vehicle = DELIVERY_FLEET.find((v) => v.id === effectiveDeliveryVehicle)
      if (vehicle !== undefined) details.delivery_vehicle = vehicle.name
      // The rider is told at which end, and on which rail, before setting off.
      details.payer = payer
      details.payment_method = paymentMethod
      /*
       * Both ends as people the rider can ring. "Me" is resolved to the
       * account *here* rather than stored in the form, so a name edited on
       * the profile is the name that travels — and so the payload never
       * carries a party the dispatcher cannot phone.
       */
      if (!sender.isMe) {
        details.sender_name = sender.name.trim()
        details.sender_phone = sender.phone.trim()
      }
      details.recipient_name = receiver.isMe ? account.name : receiver.name.trim()
      details.recipient_phone = receiver.isMe ? account.phone : receiver.phone.trim()
      details.confirm_with_pin = pinRequired
    }
    if (service === 'self_drive') {
      const model = SELF_DRIVE_FLEET.find((m) => m.id === rentalModel)
      if (model !== undefined) {
        details.vehicle_category = model.category
        details.vehicle_model = model.name
      }
      details.start_date = startDate
      details.end_date = endDate
      /*
       * Which documents the renter has to hand — not the documents
       * themselves, which stay on the device (see `KycVerification`). It
       * is what lets the desk tell a rental that is ready to collect from
       * one where somebody still has to find their licence.
       */
      const provided = Object.keys(kycFiles)
      if (provided.length > 0) details.kyc_documents = provided.join(',')
    }

    return {
      service_type: service,
      contact_name: account.name,
      contact_phone: account.phone,
      contact_email: account.email,
      pickup_location: service === 'self_drive' ? undefined : pickup.trim(),
      dropoff_location: service === 'self_drive' ? undefined : dropoff.trim(),
      // ADR-0020 §2. The form has held these since the map needed them to
      // centre; they were simply never sent, so the platform threw away the
      // one thing that makes proximity dispatch possible and then had
      // nothing to rank by.
      //
      // Sent only when the text still matches the place that was picked.
      // Somebody who selects "Acacia Mall" and then edits the field to
      // "Acacia Mall, gate 3" has moved the pin in their head; sending the
      // old coordinates would dispatch a driver to the wrong side of a
      // building with more confidence than the typed text deserves.
      ...pickupCoordinates(service, pickup, pickupPlace),
      ...dropoffCoordinates(service, dropoff, dropoffPlace),
      // Every walk-in order is immediate; the dispatcher schedules on the
      // call if the customer wants something later.
      scheduled_for: undefined,
      notes: notes.trim() || undefined,
      details,
      website: honeypot || undefined,
    }
  }

  const submit = async (account: CustomerAccount) => {
    setSubmitting(true)
    setFailure(null)
    setServerErrors({})
    try {
      // A typed address is placed here, before it goes: the driver's fare
      // estimate, journey and route all hang off the drop-off point, and a
      // string cannot be priced. See `withGeocodedEnds`.
      setReference(
        await submitPublicOrder(await withGeocodedEnds(buildPayload(account), searchPlaces)),
      )
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 422) {
        const raw: Record<string, string[]> = error.response.data.errors ?? {}
        setServerErrors(withCoordinateErrorsOnTheirFields(raw))
        // The offending field lives on an earlier step; go back to it.
        /*
         * The contact fields come off the account now, not off this form,
         * so a `contact_*` rejection is not something the customer can fix
         * on an earlier step — sending them back to one would be a loop.
         * Say so instead, and leave them on review.
         */
        if (Object.keys(raw).some((k) => k.startsWith('contact'))) {
          setFailure(
            'Your account details were rejected. Please check your name, phone and email, then try again.',
          )
        } else {
          setStep('details')
        }
      } else if (isAxiosError(error) && error.response?.status === 429) {
        setFailure('Too many orders from this connection. Please wait a minute and try again.')
      } else {
        setFailure('Something went wrong sending your order. Please try again, or call us.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (reference !== null) {
    /*
     * A rental has nobody to match — the customer collects the vehicle and
     * drives it themselves — so it keeps the dispatcher-callback receipt.
     * Rides and deliveries both send a person, and that person arriving is
     * what the matching screen is about.
     */
    return service === 'self_drive' ? (
      <SuccessScreen reference={reference} />
    ) : (
      <RideScreen
        reference={reference}
        pickup={pickup}
        dropoff={dropoff}
        // The pickup is the subject of the matching screen, not the phone —
        // they differ whenever someone ordered for a point they are not
        // standing at. The device fix is only the fallback.
        near={tripFrom ?? myPosition}
        from={tripFrom}
        to={tripTo}
      />
    )
  }

  return (
    <div className="min-h-[100dvh] bg-surface-page text-text-body">
      <OrderNav />
      {/* Two arrangements of the same DOM. Mobile is the app mockup: the map
          fills the screen, the header floats, and the form lives in a bottom
          sheet. From lg up it becomes the Uber split: form column on the
          left, map owning the rest of the viewport. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,34rem)_1fr]">
        {/* The sheet yields half the screen once there is a trip to look
            at: the route is drawn behind it, and at 78dvh the map strip
            left over was too thin to read it in. Matches the bottom
            padding the map reserves when it fits the route.
            The confirm screen is the exception: it is a page to read, not a
            route to look at, and a summary delivered through a letterbox is
            a summary nobody reads to the bottom. */}
        <main
          ref={sheetRef}
          className={`kr-sheet fixed inset-x-0 bottom-0 z-30 w-full overflow-y-auto rounded-t-3xl border-t border-border bg-surface-card px-5 pb-[max(2rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(0,16,40,0.16)] transition-[max-height] duration-300 ease-[var(--kr-ease-out)] lg:static lg:z-auto lg:max-h-none lg:max-w-none lg:animate-none lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent lg:px-10 lg:pb-20 lg:pt-8 lg:shadow-none lg:transition-none lg:[transform:none] ${
            step === 'review' || step === 'parties' || step === 'kyc'
              ? 'max-h-[88dvh]'
              : tripVisualised
                ? 'max-h-[52dvh]'
                : 'max-h-[78dvh]'
          }`}
        >
          {/* The sheet's grab handle, purely visual on the web. */}
          <div
            className="mx-auto mb-4 mt-3 h-1 w-10 rounded-full bg-border lg:hidden"
            aria-hidden
          />
          {/* The home sheet reads as a menu, not a wizard: the progress rail
              only appears once a service has been picked. */}
          <ol
            className={`items-center gap-2 ${step === 'service' ? 'hidden lg:flex' : 'flex'}`}
            aria-label="Progress"
          >
            {steps.map((s, i) => (
              <li
                key={s}
                aria-current={s === step ? 'step' : undefined}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i <= stepIndex ? 'bg-brand-green' : 'bg-surface-sunken'
                }`}
              />
            ))}
          </ol>

          {failure !== null && (
            <p
              role="alert"
              className="mt-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            >
              {failure}
            </p>
          )}

          {step === 'service' && (
            <StepShell title="What would you like to do?" centerTitle>
              {/* The app mockup's home sheet: three upright cards in a row,
                  icon above a green label above a two-line description. */}
              <div className="grid grid-cols-3 gap-3">
                {(Object.keys(SERVICE_META) as PublicService[]).map((key) => {
                  const icons: Record<PublicService, React.ReactNode> = {
                    ride: <Car className="h-7 w-7" aria-hidden />,
                    delivery: <Package className="h-7 w-7" aria-hidden />,
                    self_drive: <KeyRound className="h-7 w-7" aria-hidden />,
                  }
                  const tints: Record<PublicService, string> = {
                    ride: 'bg-brand-green-tint',
                    delivery: 'bg-surface-accent',
                    self_drive: 'bg-surface-sunken',
                  }
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setService(key)
                        setStep(key === 'delivery' ? 'vehicle' : 'details')
                      }}
                      className={`flex flex-col items-center gap-3 rounded-2xl border border-transparent px-3 py-6 text-center transition-[transform,box-shadow,border-color,background-color] duration-150 ease-[var(--kr-ease-out)] hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.98] ${tints[key]}`}
                    >
                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-card text-brand-green shadow-sm">
                        {icons[key]}
                      </span>
                      <span className="font-display font-semibold text-brand-green">
                        {SERVICE_META[key].label}
                      </span>
                      <span className="text-xs leading-relaxed text-text-secondary">
                        {SERVICE_META[key].short}
                      </span>
                    </button>
                  )
                })}
              </div>
            </StepShell>
          )}

          {step === 'details' && (
            <StepShell
              title={
                service === 'ride'
                  ? 'Where are you going?'
                  : service === 'delivery'
                    ? 'Where is it going?'
                    : 'Your rental'
              }
              onBack={() => setStep(service === 'delivery' ? 'vehicle' : 'service')}
            >
              {/* Uber's form language: the field name lives in the row as an
                  icon and a placeholder, not a label above. Labels stay in the
                  DOM (sr-only) for screen readers and the tests. */}
              <div className="space-y-3">
                {service === 'ride' && (
                  <>
                    <RidePickupCard
                      pickup={pickup}
                      onPickupChange={setPickup}
                      rideFor={rideFor}
                      onRideForChange={setRideFor}
                      riderName={riderName}
                      onRiderNameChange={setRiderName}
                      riderPhone={riderPhone}
                      onRiderPhoneChange={setRiderPhone}
                      error={serverErrors.pickup_location}
                    />
                    <DestinationSearch
                      value={dropoff}
                      onChange={(next, place) => {
                        setDropoff(next)
                        setDropoffPlace(place ?? null)
                      }}
                      error={serverErrors.dropoff_location}
                      onHistoryPick={() => {
                        // A history pick is a known destination - jump ahead,
                        // as long as the rest of the step is already complete.
                        const riderReady =
                          rideFor === 'myself' ||
                          (riderName.trim() !== '' && riderPhone.trim().length >= 9)
                        if (pickup.trim() !== '' && riderReady) setStep('vehicle')
                      }}
                    />
                  </>
                )}

                {service === 'delivery' && (
                  <>
                    {/* The route reads as one journey: two numbered stops on
                        a single rail, green out and red in. */}
                    <div className="rounded-2xl border border-border bg-surface-card p-4">
                      <RouteStop
                        index={1}
                        title="Pickup location"
                        tone="pickup"
                        value={pickup}
                        place={pickupPlace}
                        placeholder="Where are we collecting?"
                        error={serverErrors.pickup_location}
                        onChange={(next, place) => {
                          setPickup(next)
                          setPickupPlace(place)
                          if (place?.lngLat !== undefined) setMyPosition(place.lngLat)
                        }}
                      />
                      <div className="mb-4 border-t border-border" />
                      <RouteStop
                        index={2}
                        title="Drop-off location"
                        tone="dropoff"
                        value={dropoff}
                        place={dropoffPlace}
                        placeholder="Where is it going?"
                        error={serverErrors.dropoff_location}
                        onChange={(next, place) => {
                          setDropoff(next)
                          setDropoffPlace(place)
                        }}
                      />

                      <div className="border-t border-border pt-4">
                        <p className="font-display font-semibold text-text-heading">
                          What are you sending?
                        </p>
                        <div
                          role="radiogroup"
                          aria-label="What are you sending?"
                          className="mt-3 grid grid-cols-4 gap-2"
                        >
                          {ITEM_TYPES.map((item) => {
                            const selected = itemType === item.value
                            return (
                              <button
                                key={item.value}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => setItemType(item.value)}
                                className={`flex flex-col items-center gap-2 rounded-xl border px-1 py-3 transition-[border-color,background-color,transform] duration-150 ease-[var(--kr-ease-out)] active:scale-[0.97] ${
                                  selected
                                    ? 'border-brand-green bg-surface-accent text-brand-green'
                                    : 'border-border bg-surface-page text-text-secondary hover:text-text-heading'
                                }`}
                              >
                                {item.icon}
                                <span
                                  className={`text-xs ${selected ? 'font-semibold' : 'font-medium'}`}
                                >
                                  {item.label}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {service === 'self_drive' && (
                  <>
                    <DateRangePicker
                      start={startDate}
                      end={endDate}
                      onChange={(nextStart, nextEnd) => {
                        setStartDate(nextStart)
                        setEndDate(nextEnd)
                      }}
                    />
                    {(serverErrors['details.start_date'] !== undefined ||
                      serverErrors['details.end_date'] !== undefined) && (
                      <p className="text-sm text-red-600 dark:text-red-400">
                        {serverErrors['details.start_date'] ?? serverErrors['details.end_date']}
                      </p>
                    )}
                  </>
                )}
              </div>
              <NextButton
                disabled={!detailsValid}
                onClick={() => setStep(service === 'delivery' ? afterChoices : 'vehicle')}
              />
            </StepShell>
          )}

          {step === 'vehicle' && service === 'delivery' && (
            <StepShell title="Choose a vehicle" onBack={() => setStep('service')}>
              {/* The size → vehicle bridge, with an escape hatch back to it. */}
              <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-surface-sunken px-4 py-3 text-sm">
                <p className="text-text-secondary">
                  Based on your package size:{' '}
                  {(() => {
                    const label =
                      PACKAGE_SIZES.find((s) => s.value === packageSize)?.label ?? packageSize
                    const [name, ...rest] = label.split(' (')
                    return (
                      <>
                        <span className="font-semibold text-brand-green">{name}</span>
                        {rest.length > 0 && <span> ({rest.join(' (')}</span>}
                      </>
                    )
                  })()}
                </p>
                <button
                  type="button"
                  aria-expanded={sizeOpen}
                  onClick={() => setSizeOpen((open) => !open)}
                  className="shrink-0 font-semibold text-brand-green transition-colors hover:text-brand-green-hover"
                >
                  Change
                </button>
              </div>
              {sizeOpen && (
                <div className="kr-rise mb-4">
                  <IconSelect
                    icon={<Weight className="h-4 w-4 text-text-secondary" />}
                    label="Package size"
                    value={packageSize}
                    onChange={(value) => {
                      setPackageSize(value)
                      // The recommendation follows the size until overridden.
                      setDeliveryVehicle(null)
                    }}
                    options={PACKAGE_SIZES}
                  />
                </div>
              )}

              <div role="radiogroup" aria-label="Vehicle" className="space-y-3">
                {DELIVERY_FLEET.map((vehicle) => {
                  const selected = effectiveDeliveryVehicle === vehicle.id
                  return (
                    <button
                      key={vehicle.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        setDeliveryVehicle(vehicle.id)
                        revealContinue()
                      }}
                      className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-[border-color,background-color,transform] duration-150 ease-[var(--kr-ease-out)] active:scale-[0.99] ${
                        selected
                          ? 'border-brand-green bg-surface-accent'
                          : 'border-border bg-surface-card'
                      }`}
                    >
                      <img
                        src={`/assets/vehicles/${vehicle.sprite}.svg`}
                        alt=""
                        className="h-12 w-20 shrink-0 object-contain"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block whitespace-nowrap font-display font-semibold text-text-heading">
                          {vehicle.name}
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-text-secondary">
                          {vehicle.blurb}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold text-text-heading">
                        {vehicle.fare}
                      </span>
                      {selected ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-brand-green" aria-hidden />
                      ) : (
                        <span className="h-5 w-5 shrink-0" aria-hidden />
                      )}
                    </button>
                  )
                })}
              </div>
              <p className="mt-3 text-xs text-text-secondary">
                Prices are starting fares. The dispatcher confirms the exact price on the call.
              </p>
              <div ref={continueRef}>
                <NextButton
                  disabled={effectiveDeliveryVehicle === null}
                  onClick={() => setStep('details')}
                />
              </div>
            </StepShell>
          )}

          {step === 'vehicle' && service === 'self_drive' && (
            <StepShell title="Pick a vehicle for your trip" onBack={() => setStep('details')}>
              {/* Category chips, as in the app mockup. */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {RENTAL_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    aria-pressed={rentalFilter === filter.value}
                    onClick={() => setRentalFilter(filter.value)}
                    className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-150 ease-[var(--kr-ease-out)] ${
                      rentalFilter === filter.value
                        ? 'bg-brand-green text-text-on-brand'
                        : 'bg-surface-sunken text-text-secondary hover:text-text-heading'
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              <div role="radiogroup" aria-label="Vehicle" className="mt-4 space-y-3">
                {SELF_DRIVE_FLEET.filter(
                  (m) => rentalFilter === 'all' || m.category === rentalFilter,
                ).map((model) => {
                  const selected = rentalModel === model.id
                  return (
                    <button
                      key={model.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        setRentalModel(model.id)
                        revealContinue()
                      }}
                      className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-[border-color,background-color,transform] duration-150 ease-[var(--kr-ease-out)] active:scale-[0.99] ${
                        selected
                          ? 'border-brand-green bg-surface-accent'
                          : 'border-border bg-surface-card'
                      }`}
                    >
                      <img
                        src={`/assets/vehicles/${model.sprite}.svg`}
                        alt=""
                        className="h-16 w-28 shrink-0 object-contain"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-display font-semibold text-text-heading">
                          {model.name}
                        </span>
                        <span className="mt-0.5 block text-sm text-text-secondary">
                          {model.transmission} · {model.seats} seats
                        </span>
                        <span className="mt-1 block font-semibold text-brand-green">
                          {model.rate} / day
                        </span>
                      </span>
                      {selected ? (
                        <CheckCircle2 className="h-6 w-6 shrink-0 text-brand-green" aria-hidden />
                      ) : (
                        <span className="h-6 w-6 shrink-0" aria-hidden />
                      )}
                    </button>
                  )
                })}
              </div>
              <p className="mt-3 text-xs text-text-secondary">
                Day rates are indicative. The dispatcher confirms availability and the final rate.
              </p>
              <div ref={continueRef}>
                <NextButton disabled={rentalModel === null} onClick={() => setStep(afterChoices)} />
              </div>
            </StepShell>
          )}

          {step === 'vehicle' && service === 'ride' && (
            <StepShell title="Choose a ride" onBack={() => setStep('details')}>
              <div role="radiogroup" aria-label="Vehicle" className="space-y-3">
                {RIDE_CLASSES.map((klass) => {
                  const selected = vehicleClass === klass.value
                  return (
                    <button
                      key={klass.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        setVehicleClass(klass.value)
                        revealContinue()
                      }}
                      className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-[border-color,background-color,transform] duration-150 ease-[var(--kr-ease-out)] active:scale-[0.99] ${
                        selected
                          ? 'border-brand-green bg-surface-accent'
                          : 'border-border bg-surface-card'
                      }`}
                    >
                      <img
                        src={`/assets/vehicles/${klass.sprite}.svg`}
                        alt=""
                        className="h-14 w-24 shrink-0 object-contain"
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block font-display font-semibold ${
                            selected ? 'text-brand-green' : 'text-text-heading'
                          }`}
                        >
                          {klass.label}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-sm text-text-secondary">
                          <Users className="h-3.5 w-3.5" aria-hidden />
                          {klass.seats}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        {(() => {
                          const quote = fareQuotes?.[klass.value as RideClass] ?? null
                          return quote !== null ? (
                            <>
                              <span className="block text-xs text-text-secondary">est.</span>
                              <span className="block font-semibold text-text-heading">
                                {formatUgx(quote.total_minor)}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="block text-xs text-text-secondary">from</span>
                              <span className="block font-semibold text-text-heading">
                                {klass.fare}
                              </span>
                            </>
                          )
                        })()}
                      </span>
                      {selected ? (
                        <CheckCircle2 className="h-6 w-6 shrink-0 text-brand-green" aria-hidden />
                      ) : (
                        <span className="h-6 w-6 shrink-0" aria-hidden />
                      )}
                    </button>
                  )
                })}
              </div>
              <p className="mt-3 text-xs text-text-secondary">
                Fares are starting prices. The final fare follows the distance and time of the trip.
              </p>
              <div ref={continueRef}>
                {/* The last tap of a ride: no confirm screen follows it. */}
                <NextButton
                  disabled={false}
                  busy={submitting}
                  label={customer === null ? 'Continue' : 'Request ride'}
                  onClick={finishChoices}
                />
                {/*
                  W1-e. A ride has no confirm screen, so this is the last
                  surface before the order goes — for a signed-in customer this
                  button submits. The notice has to be here or it is not
                  "before submission" for the commonest order on the platform.
                */}
                {customer !== null && <PrivacyLine />}
              </div>
            </StepShell>
          )}

          {/* The rental's identity checks, between the vehicle and the
              confirm screen. Nothing else on this page asks for them:
              a ride and a delivery both send a driver of ours. */}
          {step === 'kyc' && (
            <KycVerification
              sections={RENTAL_KYC}
              files={kycFiles}
              onFilesChange={setKycFiles}
              submitting={submitting}
              onSubmit={() => setStep('review')}
              onBack={() => setStep(customer !== null ? 'vehicle' : 'account')}
            />
          )}

          {step === 'account' && sessionLoading && (
            <StepShell
              title="One moment"
              onBack={() => setStep(service === 'delivery' ? 'details' : 'vehicle')}
            >
              {/* A stored token is still being resolved. Showing the
                  sign-up form here would ask a returning customer to
                  create the account they already have. */}
              <p className="text-text-secondary">Checking whether you are already signed in…</p>
            </StepShell>
          )}

          {step === 'account' && !sessionLoading && (
            <AccountStep
              onBack={() => setStep(service === 'delivery' ? 'details' : 'vehicle')}
              onAuthenticated={(next) => {
                adopt(next)
                // A ride goes out on the same tap that created the account.
                // `next` is passed to submit rather than read back from
                // state, which `adopt` has not flushed yet.
                if (service === 'ride') void submit(next)
                else setStep(service === 'self_drive' ? 'kyc' : 'review')
              }}
              submitLabel={service === 'ride' ? 'Create account & request ride' : undefined}
              honeypot={honeypot}
              onHoneypot={setHoneypot}
              footer={<PrivacyLine />}
            />
          )}

          {/* A parcel confirms on its own screen: it is the one order where
              the money has a question in it (who pays, on which rail), and
              the one with a route worth reading back in full. */}
          {step === 'review' && service === 'delivery' && (
            <DeliverySummary
              pickup={pickup}
              pickupPlace={pickupPlace}
              dropoff={dropoff}
              dropoffPlace={dropoffPlace}
              vehicleName={
                DELIVERY_FLEET.find((v) => v.id === effectiveDeliveryVehicle)?.name ?? ''
              }
              fare={DELIVERY_FLEET.find((v) => v.id === effectiveDeliveryVehicle)?.fare ?? ''}
              estimate={tripEstimate(tripFrom, tripTo)}
              payer={payer}
              onPayerChange={setPayer}
              paymentMethod={paymentMethod}
              onPaymentMethodChange={setPaymentMethod}
              notes={notes}
              onNotesChange={setNotes}
              onConfirm={() => setStep('parties')}
              onBack={() => setStep(customer !== null ? 'details' : 'account')}
            />
          )}

          {/* Who is at each end of the parcel — the last thing asked, and
              the last thing before it is placed. */}
          {step === 'parties' && (
            <DeliveryParties
              customerName={customer?.name ?? ''}
              sender={sender}
              onSenderChange={setSender}
              receiver={receiver}
              onReceiverChange={setReceiver}
              pinRequired={pinRequired}
              onPinRequiredChange={setPinRequired}
              submitting={submitting}
              onContinue={() => {
                // Non-null by construction: this step is unreachable without
                // an account. The guard is for the compiler, not the user.
                if (customer !== null) void submit(customer)
              }}
              onBack={() => setStep('review')}
            />
          )}

          {step === 'review' && service !== 'delivery' && (
            <StepShell
              title="Confirm your order"
              onBack={() =>
                // A rental came through its identity checks; everything else
                // came from the vehicle — or, signed out, from the sign-up.
                setStep(
                  service === 'self_drive' ? 'kyc' : customer !== null ? 'vehicle' : 'account',
                )
              }
            >
              <dl className="divide-y divide-border rounded-xl border border-border bg-surface-card">
                <ReviewRow label="Service" value={SERVICE_META[service].label} />
                {service !== 'self_drive' && (
                  <>
                    <ReviewRow label="Pickup" value={pickup} />
                    <ReviewRow label="Drop-off" value={dropoff} />
                    <ReviewRow label="When" value="As soon as possible" />
                  </>
                )}
                {service === 'self_drive' && (
                  <>
                    <ReviewRow label="Dates" value={`${startDate} to ${endDate}`} />
                    <ReviewRow
                      label="Vehicle"
                      value={SELF_DRIVE_FLEET.find((m) => m.id === rentalModel)?.name ?? ''}
                    />
                  </>
                )}
                {service === 'ride' && (
                  <ReviewRow
                    label="Vehicle"
                    value={RIDE_CLASSES.find((k) => k.value === vehicleClass)?.label ?? ''}
                  />
                )}
                {service === 'ride' && rideFor === 'other' && riderName.trim() !== '' && (
                  <ReviewRow label="Rider" value={`${riderName} · ${riderPhone}`} />
                )}
                <ReviewRow label="Name" value={customer?.name ?? ''} />
                <ReviewRow label="Phone" value={customer?.phone ?? ''} />
              </dl>
              {/* Asked here rather than assumed: the driver reads it off the
                  trip before the kerb, and "cash" is a choice, not a default
                  the passenger never saw. */}
              {service === 'ride' && (
                <PaymentMethodField
                  className="mt-4"
                  value={paymentMethod}
                  onChange={setPaymentMethod}
                  cashLabel="Cash"
                />
              )}
              <div className="mt-4">
                <label className="mb-1 block text-sm font-medium text-text-heading">
                  Anything else? <span className="font-normal text-text-secondary">(optional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  className="w-full rounded-lg border border-border-input bg-surface-page px-4 py-3 text-text-body outline-none transition-[border-color] duration-150 ease-[var(--kr-ease-out)] focus:border-brand-green"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  // Non-null by construction: review is unreachable without
                  // an account. The guard is for the compiler, not the user.
                  if (customer !== null) void submit(customer)
                }}
                disabled={submitting}
                className="mt-6 w-full rounded-lg bg-brand-green px-6 py-3 font-semibold text-text-on-brand transition-[background-color,transform,opacity] duration-150 ease-[var(--kr-ease-out)] hover:bg-brand-green-hover active:scale-[0.98] disabled:opacity-60"
              >
                {submitting ? 'Sending…' : 'Place order'}
              </button>
            </StepShell>
          )}
        </main>
        <MapPanel
          pickup={service === 'self_drive' ? '' : pickup}
          dropoff={service === 'self_drive' ? '' : dropoff}
          center={myPosition}
          from={service === 'self_drive' ? null : tripFrom}
          to={service === 'self_drive' ? null : tripTo}
          fleet={fleet}
        />
      </div>
    </div>
  )
}

function StepShell({
  title,
  children,
  onBack,
  centerTitle = false,
}: {
  title: string
  children: React.ReactNode
  onBack?: () => void
  centerTitle?: boolean
}) {
  return (
    <div className="kr-rise mt-5 lg:mt-8">
      {onBack !== undefined && (
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary transition-colors hover:text-text-heading"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back
        </button>
      )}
      <h1
        className={`font-display text-2xl font-bold tracking-tight text-text-heading ${
          centerTitle ? 'text-center lg:text-left' : ''
        }`}
      >
        {title}
      </h1>
      <div className="relative mt-6">{children}</div>
    </div>
  )
}

/** The slice of Google Identity Services this page touches. */
interface GsiNamespace {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string
        callback: (response: { credential: string }) => void
      }) => void
      /** Opens the One Tap / account-chooser prompt. */
      prompt: () => void
    }
  }
}

/** The ID-token claims we read. The token is Google-signed; good enough to prefill a form. */
function decodeJwtPayload(jwt: string): { name?: string; email?: string } | null {
  try {
    const base64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as { name?: string; email?: string }
  } catch {
    return null
  }
}

function GoogleLogo() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.32A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.96H.96a9 9 0 0 0 0 8.08l3.01-2.32Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.96l3.01 2.32C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  )
}

function FacebookLogo() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path
        fill="#FFFFFF"
        d="M16.7 15.5l.53-3.47h-3.33V9.78c0-.95.46-1.87 1.95-1.87h1.51V4.96s-1.37-.23-2.68-.23c-2.73 0-4.52 1.66-4.52 4.66v2.64H7.11v3.47h3.05V24a12.1 12.1 0 0 0 3.74 0v-8.5h2.8Z"
      />
    </svg>
  )
}

/**
 * "Or fill in with" Google / Facebook — a prefill, deliberately not a
 * sign-in (ADR-0012 §3: no customer accounts exist yet). Google runs
 * Google Identity Services when VITE_GOOGLE_CLIENT_ID is configured and
 * prefills the visitor's name and email; either button explains itself
 * when its provider isn't configured yet. The ID token is decoded
 * client-side without signature verification, which is fine for
 * prefilling a form the visitor can edit anyway and would NOT be fine
 * for authentication — a real customer sign-in must verify the token
 * server-side against Google's keys. The order itself still travels the
 * unauthenticated walk-in endpoint.
 */
function SocialPrefill({
  onIdentity,
}: {
  onIdentity: (id: { name: string; email: string }) => void
}) {
  const [note, setNote] = useState<string | null>(null)
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

  const onIdentityRef = useRef(onIdentity)
  useEffect(() => {
    onIdentityRef.current = onIdentity
  })

  useEffect(() => {
    if (!clientId || import.meta.env.MODE === 'test') return
    let cancelled = false

    const init = () => {
      if (cancelled) return
      try {
        const google = (window as unknown as { google?: GsiNamespace }).google
        google?.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            const claims = decodeJwtPayload(response.credential)
            if (claims !== null) {
              onIdentityRef.current({ name: claims.name ?? '', email: claims.email ?? '' })
            }
          },
        })
      } catch {
        // Handled at click time: the button falls back to the note below.
      }
    }

    const src = 'https://accounts.google.com/gsi/client'
    if (document.querySelector(`script[src="${src}"]`) !== null) {
      init()
    } else {
      const script = document.createElement('script')
      script.src = src
      script.async = true
      script.onload = init
      document.head.appendChild(script)
    }
    return () => {
      cancelled = true
    }
  }, [clientId])

  const clickGoogle = () => {
    const google = (window as unknown as { google?: GsiNamespace }).google
    if (!clientId || google === undefined) {
      setNote("Google prefill isn't set up yet - the form above works without it.")
      return
    }
    google.accounts.id.prompt()
  }

  const clickFacebook = () => {
    setNote("Facebook prefill isn't set up yet - the form above works without it.")
  }

  return (
    <div className="mt-5">
      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-text-secondary">or fill in with</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={clickGoogle}
          className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-card px-4 py-2.5 text-sm font-semibold text-text-heading transition-[background-color,transform] duration-150 ease-[var(--kr-ease-out)] hover:bg-surface-sunken active:scale-[0.98]"
        >
          <GoogleLogo />
          Google
        </button>
        <button
          type="button"
          onClick={clickFacebook}
          className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-card px-4 py-2.5 text-sm font-semibold text-text-heading transition-[background-color,transform] duration-150 ease-[var(--kr-ease-out)] hover:bg-surface-sunken active:scale-[0.98]"
        >
          <FacebookLogo />
          Facebook
        </button>
      </div>
      {note !== null && <p className="mt-2 text-center text-xs text-text-secondary">{note}</p>}
    </div>
  )
}

/**
 * A location box with debounced geocoder suggestions. Free text always
 * stands on its own — picking a suggestion is an accelerator that also
 * yields the two-line form (name over address) the route card shows.
 */
function PlaceSearch({
  label,
  value,
  placeholder,
  error,
  onChange,
  onPick,
  offerCurrentLocation = false,
}: {
  label: string
  value: string
  placeholder: string
  error?: string
  onChange: (value: string) => void
  onPick: (hit: PlaceHit) => void
  /** Pins "Use my current location" above the suggestions. */
  offerCurrentLocation?: boolean
}) {
  const id = useId()
  // The debounce, abort and "only search what was typed" rule live in the
  // hook, shared with the internal booking dialog's PlaceField. Only the
  // chrome differs between them.
  const { hits, markTyped, settle } = usePlaceSearch(value)
  const [locating, setLocating] = useState(false)
  const [locateFailed, setLocateFailed] = useState(false)

  const useHere = () => {
    setLocating(true)
    setLocateFailed(false)
    void currentLocationPlace().then((place) => {
      setLocating(false)
      if (place === null) {
        setLocateFailed(true)
        return
      }
      settle()
      onPick(place)
    })
  }

  return (
    <div>
      <label
        htmlFor={id}
        className={`flex items-center gap-3 rounded-lg border bg-surface-page px-4 py-3 transition-[border-color] duration-150 ease-[var(--kr-ease-out)] focus-within:border-brand-green ${
          error !== undefined ? 'border-red-400' : 'border-border-input'
        }`}
      >
        <Search className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
        <span className="sr-only">{label}</span>
        <input
          id={id}
          type="text"
          value={value}
          autoComplete="off"
          placeholder={placeholder}
          aria-invalid={error !== undefined || undefined}
          onChange={(e) => {
            markTyped()
            onChange(e.target.value)
          }}
          className="w-full min-w-0 bg-transparent text-text-body outline-none placeholder:text-text-placeholder"
        />
      </label>
      {error !== undefined && (
        <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      {locateFailed && (
        <p className="mt-1.5 text-sm text-text-secondary">
          We couldn&apos;t read your location — type the address instead.
        </p>
      )}
      {(offerCurrentLocation || hits.length > 0) && (
        <ul className="mt-2 overflow-hidden rounded-xl border border-border bg-surface-card">
          {offerCurrentLocation && (
            <li>
              <button
                type="button"
                onClick={useHere}
                disabled={locating}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-sunken disabled:opacity-60"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-green-tint text-brand-green">
                  <LocateFixed
                    className={`h-4 w-4 ${locating ? 'animate-pulse' : ''}`}
                    aria-hidden
                  />
                </span>
                <span className="font-medium text-brand-green">
                  {locating ? 'Finding you…' : 'Use my current location'}
                </span>
              </button>
            </li>
          )}
          {hits.map((hit) => (
            <li key={`${hit.name}|${hit.detail}`}>
              <button
                type="button"
                onClick={() => {
                  settle()
                  onPick(hit)
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-sunken"
              >
                <MapPin className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-text-heading">{hit.name}</span>
                  {hit.detail !== '' && (
                    <span className="block truncate text-sm text-text-secondary">{hit.detail}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * One stop on the delivery route: a numbered badge, the place in two lines
 * (name over address, as the geocoder returns it), and a pencil that swaps
 * the row for a search box. Green for the pickup, red for the drop-off, so
 * the two ends stay distinguishable at a glance.
 */
function RouteStop({
  index,
  title,
  tone,
  value,
  place,
  onChange,
  placeholder,
  error,
}: {
  index: number
  title: string
  tone: 'pickup' | 'dropoff'
  value: string
  place: PlaceHit | null
  onChange: (value: string, place: PlaceHit | null) => void
  placeholder: string
  error?: string
}) {
  // Settled means a *place* was chosen or located — not merely that the
  // box has text in it. Keying off the text collapsed the row on the first
  // keystroke, which unmounted the input mid-word and meant the search
  // never ran. A located pickup still collapses on its own, because
  // geolocation supplies a place.
  const [editRequested, setEditRequested] = useState(false)
  const editing = editRequested || place === null
  const dot = tone === 'pickup' ? 'bg-brand-green' : 'bg-red-500'
  const text = tone === 'pickup' ? 'text-brand-green' : 'text-red-500'

  return (
    // Two rows sharing one rail: the badge sits with the label, the stop
    // dot with the place itself, and the dashed line joins them.
    <div className="grid grid-cols-[1.75rem_1fr] gap-x-3">
      <span
        className={`grid h-7 w-7 place-items-center rounded-full text-sm font-semibold text-white ${dot}`}
        aria-hidden
      >
        {index}
      </span>
      <p className={`self-center text-sm font-semibold ${text}`}>{title}</p>

      <div className="relative flex justify-center" aria-hidden>
        <span className="absolute inset-y-0 w-px border-l border-dashed border-border-strong" />
        <span className={`relative mt-2 h-3 w-3 rounded-full ring-4 ring-surface-card ${dot}`} />
      </div>

      <div className="min-w-0 pb-5 pt-1">
        {editing ? (
          <PlaceSearch
            label={title}
            value={value}
            placeholder={placeholder}
            error={error}
            offerCurrentLocation={tone === 'pickup'}
            onChange={(next) => onChange(next, null)}
            onPick={(hit) => {
              // A located place already carries the drivable address.
              onChange(hit.name === 'Current location' ? hit.detail : placeLabel(hit), hit)
              setEditRequested(false)
            }}
          />
        ) : (
          <>
            <div className="flex items-start gap-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-text-heading">
                  {place?.name ?? value}
                </span>
                {(place?.detail ?? '') !== '' && (
                  <span className="mt-0.5 block truncate text-sm text-text-secondary">
                    {place?.detail}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => setEditRequested(true)}
                aria-label={`Edit ${title.toLowerCase()}`}
                className="shrink-0 text-brand-green transition-colors hover:text-brand-green-hover"
              >
                <Pencil className="h-4 w-4" aria-hidden />
              </button>
            </div>
            {error !== undefined && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The ride pickup card (mockup: "Pickup · Current location · <address>" with
 * a pencil). Collapsed it summarises; expanded it asks who the ride is for -
 * "Myself" offers device location, "Someone else" collects the rider's
 * name and phone so the dispatcher can reach them.
 */
function RidePickupCard({
  pickup,
  onPickupChange,
  rideFor,
  onRideForChange,
  riderName,
  onRiderNameChange,
  riderPhone,
  onRiderPhoneChange,
  error,
}: {
  pickup: string
  onPickupChange: (value: string) => void
  rideFor: 'myself' | 'other'
  onRideForChange: (value: 'myself' | 'other') => void
  riderName: string
  onRiderNameChange: (value: string) => void
  riderPhone: string
  onRiderPhoneChange: (value: string) => void
  error?: string
}) {
  const [expanded, setExpanded] = useState(pickup.trim() === '')
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState<string | null>(null)

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setLocateError("This browser can't share your location - please type the pickup instead.")
      return
    }
    setLocating(true)
    setLocateError(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords
        void reverseGeocode(latitude, longitude).then((address) => {
          onPickupChange(address ?? `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`)
          setLocating(false)
        })
      },
      () => {
        setLocating(false)
        setLocateError("We couldn't read your location - please type the pickup instead.")
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-surface-card">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <span
          className="mt-1 h-3 w-3 shrink-0 self-start rounded-full bg-brand-green"
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-text-heading">Pickup</span>
          <span className="mt-0.5 block truncate font-medium text-text-heading">
            {rideFor === 'myself' ? 'Myself' : riderName.trim() || 'Someone else'}
          </span>
          <span className="block truncate text-sm text-text-secondary">
            {pickup.trim() !== '' ? pickup : 'Tap to set the pickup point'}
          </span>
        </span>
        <Pencil className="h-4 w-4 shrink-0 text-brand-green" aria-hidden />
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border p-4">
          <div role="radiogroup" aria-label="Who is the ride for?" className="flex gap-2">
            {(
              [
                ['myself', 'Myself'],
                ['other', 'Someone else'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rideFor === value}
                onClick={() => onRideForChange(value)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors duration-150 ease-[var(--kr-ease-out)] ${
                  rideFor === value
                    ? 'bg-brand-green text-text-on-brand'
                    : 'bg-surface-sunken text-text-secondary hover:text-text-heading'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {rideFor === 'other' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <IconField
                icon={<User className="h-4 w-4 text-text-secondary" />}
                label="Rider's name"
                value={riderName}
                onChange={onRiderNameChange}
                placeholder="Rider's name"
              />
              <IconField
                icon={<Phone className="h-4 w-4 text-text-secondary" />}
                label="Rider's phone"
                value={riderPhone}
                onChange={onRiderPhoneChange}
                placeholder="Rider's phone"
              />
            </div>
          )}

          <IconField
            icon={<CircleDot className="h-4 w-4 text-brand-green" />}
            label="Pickup location"
            value={pickup}
            onChange={onPickupChange}
            error={error}
            placeholder="Pickup location"
          />

          {rideFor === 'myself' && (
            <button
              type="button"
              onClick={useMyLocation}
              disabled={locating}
              className="inline-flex items-center gap-2 text-sm font-medium text-brand-green transition-colors hover:text-brand-green-hover disabled:opacity-60"
            >
              <LocateFixed className="h-4 w-4" aria-hidden />
              {locating ? 'Finding you…' : 'Use my current location'}
            </button>
          )}
          {locateError !== null && <p className="text-sm text-text-secondary">{locateError}</p>}
        </div>
      )}
    </div>
  )
}

/**
 * The destination box (mockup: "Where are you going?"). Live suggestions
 * from the geocoder while typing; the visitor's recent destinations when
 * empty. Free text always works - suggestions are an accelerator, not a
 * requirement, so a geocoder outage costs nothing.
 */
function DestinationSearch({
  value,
  onChange,
  error,
  onHistoryPick,
}: {
  value: string
  onChange: (value: string, place?: PlaceHit) => void
  error?: string
  /** Fired when the visitor picks a saved destination rather than a search hit. */
  onHistoryPick?: () => void
}) {
  const id = useId()
  const [hits, setHits] = useState<PlaceHit[]>([])
  const [recent, setRecent] = useState<PlaceHit[]>(() => recentDestinations())

  useEffect(() => {
    const query = value.trim()
    const controller = new AbortController()
    const timer = setTimeout(() => {
      if (query.length < 3) {
        setHits([])
        return
      }
      void searchPlaces(query, controller.signal).then(setHits)
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [value])

  const choose = (hit: PlaceHit, fromHistory: boolean) => {
    onChange(placeLabel(hit), hit)
    rememberDestination(hit)
    setRecent(recentDestinations())
    if (fromHistory) onHistoryPick?.()
  }

  const showRecent = value.trim() === '' && recent.length > 0
  const showHits = value.trim().length >= 3 && hits.length > 0

  return (
    <div>
      <label
        htmlFor={id}
        className={`flex items-center gap-3 rounded-lg border bg-surface-page px-4 py-3 transition-[border-color] duration-150 ease-[var(--kr-ease-out)] focus-within:border-brand-green ${
          error !== undefined ? 'border-red-400' : 'border-border-input'
        }`}
      >
        <Search className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
        <span className="sr-only">Destination</span>
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Where are you going?"
          autoComplete="off"
          aria-invalid={error !== undefined || undefined}
          className="w-full min-w-0 bg-transparent text-text-body outline-none placeholder:text-text-placeholder"
        />
      </label>
      {error !== undefined && (
        <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {(showHits || showRecent) && (
        <ul className="mt-2 overflow-hidden rounded-xl border border-border bg-surface-card">
          {showRecent && (
            <li className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Recent
            </li>
          )}
          {(showHits ? hits : recent).map((hit) => (
            <li key={`${hit.name}|${hit.detail}`}>
              <button
                type="button"
                onClick={() => choose(hit, !showHits)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-sunken"
              >
                {showHits ? (
                  <MapPin className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
                ) : (
                  <History className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className="block truncate font-medium text-text-heading">{hit.name}</span>
                  {hit.detail !== '' && (
                    <span className="block truncate text-sm text-text-secondary">{hit.detail}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * An Uber-style form row: icon, sr-only (or inline) label, borderless input
 * inside one bordered pill. Same idiom as the landing hero form, so a
 * visitor arriving from there reads this as the same product.
 */
function IconField({
  icon,
  label,
  value,
  onChange,
  error,
  placeholder,
  hint,
  type = 'text',
  inlineLabel = false,
  autoComplete,
}: {
  icon: React.ReactNode
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  placeholder?: string
  hint?: string
  type?: string
  inlineLabel?: boolean
  autoComplete?: string
}) {
  const id = useId()
  /*
   * Typing a password you cannot see, on a phone, with a strength meter
   * telling you it is not good enough, is how people give up and pick
   * something short. The toggle starts hidden — shoulders exist — but it
   * is one tap away.
   */
  const [revealed, setRevealed] = useState(false)
  const isPassword = type === 'password'
  const effectiveType = isPassword && revealed ? 'text' : type

  return (
    <div>
      <label
        htmlFor={id}
        className={`flex items-center gap-3 rounded-lg border bg-surface-page px-4 py-3 transition-[border-color] duration-150 ease-[var(--kr-ease-out)] focus-within:border-brand-green ${
          error !== undefined ? 'border-red-400' : 'border-border-input'
        }`}
      >
        <span className="shrink-0" aria-hidden>
          {icon}
        </span>
        <span className={inlineLabel ? 'shrink-0 text-sm text-text-secondary' : 'sr-only'}>
          {label}
        </span>
        <input
          id={id}
          type={effectiveType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-invalid={error !== undefined || undefined}
          className="w-full min-w-0 bg-transparent text-text-body outline-none placeholder:text-text-placeholder"
        />
        {isPassword && (
          <button
            type="button"
            // Outside the label's implicit activation, or tapping it would
            // also focus the input and fight the toggle.
            onClick={(e) => {
              e.preventDefault()
              setRevealed((shown) => !shown)
            }}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
            className="-my-1 shrink-0 rounded p-1 text-text-secondary transition-colors hover:text-text-heading"
          >
            {revealed ? (
              <EyeOff className="h-4 w-4" aria-hidden />
            ) : (
              <Eye className="h-4 w-4" aria-hidden />
            )}
          </button>
        )}
      </label>
      {hint !== undefined && error === undefined && (
        <p className="mt-1.5 text-xs text-text-secondary">{hint}</p>
      )}
      {error !== undefined && (
        <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

function IconSelect({
  icon,
  label,
  value,
  onChange,
  options,
}: {
  icon: React.ReactNode
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  const id = useId()

  return (
    <label
      htmlFor={id}
      className="flex items-center gap-3 rounded-lg border border-border-input bg-surface-page px-4 py-3 transition-[border-color] duration-150 ease-[var(--kr-ease-out)] focus-within:border-brand-green"
    >
      <span className="shrink-0" aria-hidden>
        {icon}
      </span>
      <span className="sr-only">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 cursor-pointer appearance-none bg-transparent text-text-body outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
    </label>
  )
}

/**
 * Sign up, or sign in — the step that turns a visitor into an account
 * holder before their first order (ADR-0015 §1).
 *
 * Both modes live in one component because they are one decision to the
 * person in front of them ("do you already have one of these?"), and
 * because the duplicate-email rejection has to move them between the two
 * without losing the email they just typed.
 */
function AccountStep({
  onBack,
  onAuthenticated,
  honeypot,
  onHoneypot,
  submitLabel,
  footer = null,
}: {
  onBack: () => void
  onAuthenticated: (customer: CustomerAccount) => void
  honeypot: string
  onHoneypot: (value: string) => void
  /** Overrides "Create account" when this tap also places the order. */
  submitLabel?: string
  /**
   * Rendered under the submit button. W1-e passes the privacy line here: this
   * step is where a first-time customer hands over name, phone and email, and
   * for a ride the same tap places the order.
   */
  footer?: ReactNode
}) {
  const [mode, setMode] = useState<'signup' | 'login'>('signup')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [gender, setGender] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** The server recognised this email, so we moved them to the log-in. */
  const [knownEmail, setKnownEmail] = useState(false)

  const signupValid =
    firstName.trim() !== '' &&
    lastName.trim() !== '' &&
    phone.trim().length >= 9 &&
    email.trim() !== '' &&
    password.length >= MIN_PASSWORD_LENGTH
  const loginValid = email.trim() !== '' && password !== ''

  const run = async (action: () => Promise<CustomerAccount>) => {
    setBusy(true)
    setErrors({})
    setFailure(null)
    try {
      onAuthenticated(await action())
    } catch (error) {
      if (error instanceof CustomerValidationError) {
        setErrors(error.errors)
        // The one rejection with an obvious next move: they already have
        // an account, so put them in front of the log-in with the email
        // they typed still filled in.
        if (error.errors.email !== undefined && mode === 'signup') {
          setMode('login')
          setPassword('')
          setKnownEmail(true)
          // The field error would render under an input on a form they are
          // no longer looking at; the banner carries it instead.
          setErrors({})
        }
      } else if (isAxiosError(error) && error.response?.status === 401) {
        setFailure('That email and password do not match an account.')
      } else if (isAxiosError(error) && error.response?.status === 429) {
        setFailure('Too many attempts from this connection. Please wait a minute and try again.')
      } else {
        setFailure('Something went wrong. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepShell title={mode === 'signup' ? 'Create your account' : 'Welcome back'} onBack={onBack}>
      <div className="kr-rise">
        <p className="-mt-2 mb-4 text-sm text-text-secondary">
          {mode === 'signup'
            ? 'Your account keeps your trips, addresses and receipts in one place.'
            : 'Sign in and we will place this order on your account.'}
        </p>

        {knownEmail && mode === 'login' && (
          <p
            role="status"
            className="mb-4 flex items-start gap-2 rounded-lg border border-brand-green bg-surface-accent px-4 py-3 text-sm text-text-heading"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" aria-hidden />
            <span>
              You already have an account with <strong>{email}</strong>. Enter your password to
              carry on with this order.
            </span>
          </p>
        )}

        {failure !== null && (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            {failure}
          </p>
        )}

        <div className="kr-stagger space-y-3">
          {mode === 'signup' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <IconField
                  icon={<User className="h-4 w-4 text-text-secondary" />}
                  label="First name"
                  value={firstName}
                  onChange={setFirstName}
                  error={errors.first_name}
                  placeholder="First name"
                />
                <IconField
                  icon={<User className="h-4 w-4 text-text-secondary" />}
                  label="Last name"
                  value={lastName}
                  onChange={setLastName}
                  error={errors.last_name}
                  placeholder="Last name"
                />
              </div>
              <IconSelect
                icon={<Users className="h-4 w-4 text-text-secondary" />}
                label="Gender (optional)"
                value={gender}
                onChange={setGender}
                options={[
                  { value: '', label: 'Gender (optional)' },
                  ...GENDER_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
                ]}
              />
              <IconField
                icon={<Phone className="h-4 w-4 text-text-secondary" />}
                label="Phone number"
                value={phone}
                onChange={setPhone}
                error={errors.phone}
                placeholder="Phone number"
                hint="A dispatcher calls this number to confirm your order and the price."
              />
            </>
          )}

          <IconField
            icon={<Mail className="h-4 w-4 text-text-secondary" />}
            label="Email address"
            value={email}
            onChange={setEmail}
            error={errors.email}
            placeholder="Email address"
            type="email"
          />
          <IconField
            icon={<KeyRound className="h-4 w-4 text-text-secondary" />}
            label="Password"
            value={password}
            onChange={setPassword}
            error={errors.password}
            placeholder={
              mode === 'signup' ? `Password (${MIN_PASSWORD_LENGTH} characters or more)` : 'Password'
            }
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
          {mode === 'signup' && password !== '' && <PasswordMeter password={password} />}

          {/* Honeypot: humans never see it, bots autofill it. */}
          <div className="absolute left-[-9999px] top-auto" aria-hidden="true">
            <label>
              Website
              <input
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => onHoneypot(e.target.value)}
              />
            </label>
          </div>
        </div>

        <button
          type="button"
          disabled={busy || (mode === 'signup' ? !signupValid : !loginValid)}
          onClick={() =>
            void run(() =>
              mode === 'signup'
                ? registerCustomer({
                    first_name: firstName.trim(),
                    last_name: lastName.trim(),
                    gender: gender === '' ? null : (gender as CustomerGenderValue),
                    phone: phone.trim(),
                    email: email.trim(),
                    password,
                  })
                : loginCustomer(email.trim(), password),
            )
          }
          className="mt-6 w-full rounded-lg bg-brand-green px-6 py-3 font-semibold text-text-on-brand transition-[background-color,transform,opacity] duration-150 ease-[var(--kr-ease-out)] hover:bg-brand-green-hover active:scale-[0.98] disabled:opacity-50"
        >
          {busy
            ? 'Please wait…'
            : mode === 'signup'
              ? (submitLabel ?? 'Create account')
              : 'Sign in'}
        </button>

        {/*
          Under the button on both modes, not only sign-up. A returning
          customer's tap here also places a ride, so it is a submission either
          way — and the notice belongs at the submission, not at the form that
          happens to collect the most fields.
        */}
        {footer}

        <p className="mt-4 text-center text-sm text-text-secondary">
          {mode === 'signup' ? 'Already have an account?' : 'New to KangaruRide?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'signup' ? 'login' : 'signup')
              setErrors({})
              setFailure(null)
              setKnownEmail(false)
            }}
            className="font-semibold text-brand-green transition-colors hover:text-brand-green-hover"
          >
            {mode === 'signup' ? 'Log in' : 'Create one'}
          </button>
        </p>

        {/* On both modes. Signing in still benefits from having the email
            filled for you — it is the half of the form you are most likely
            to mistype — even though this is a prefill and not yet an
            identity (ADR-0015: real Google sign-in needs server-side token
            verification, which does not exist). */}
        <SocialPrefill
          onIdentity={({ name, email: socialEmail }) => {
            if (mode === 'signup') {
              // Google hands back one display name; split it the same way
              // the server's backfill did, so the two agree.
              const parts = name.trim().split(/\s+/)
              if (parts[0] !== undefined && parts[0] !== '') setFirstName(parts[0])
              if (parts.length > 1) setLastName(parts.slice(1).join(' '))
            }
            if (socialEmail !== '') setEmail(socialEmail)
          }}
        />
      </div>
    </StepShell>
  )
}

/**
 * The strength meter. Four segments and a word, never a blocker — the
 * only thing that actually stops a sign-up is the server's eight-character
 * floor, and a meter that refuses passwords teaches people to append "1!".
 */
function PasswordMeter({ password }: { password: string }) {
  const { score, label, hint, level, requirements } = passwordStrength(password)

  const fill =
    level === 'strong'
      ? 'bg-brand-green'
      : level === 'good'
        ? 'bg-green-500'
        : level === 'fair'
          ? 'bg-amber-500'
          : 'bg-red-500'

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden>
          {/*
            The scorer's own ceiling, not a literal four. These were two
            separate hardcoded fours — one here, one in the scorer — and a
            fifth point would have rendered as a bar that was already full.
          */}
          {Array.from({ length: STRENGTH_SEGMENTS }, (_, i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors duration-200 ${
                i < score ? fill : 'bg-surface-sunken'
              }`}
            />
          ))}
        </div>
        {/* Announced politely: it changes on every keystroke, and an
            assertive region would interrupt the typing it describes. */}
        <span className="w-16 shrink-0 text-right text-xs font-medium text-text-secondary">
          <span className="sr-only">Password strength: </span>
          {label}
        </span>
      </div>
      {/*
        The scale, in the open — the third copy of this fix, after the driver
        app's and the console's. A bar whose standard is invisible grades
        against a rule the person was never told.
      */}
      <ul className="mt-1.5 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
        {requirements.map((requirement) => (
          <li key={requirement.key} className="flex items-center gap-1.5">
            {/* The words carry it, never the colour: screen-rules §6. */}
            <span className="sr-only">{requirement.met ? 'Met: ' : 'Not yet: '}</span>
            {requirement.met ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand-green" aria-hidden />
            ) : (
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-border"
                aria-hidden
              />
            )}
            <span
              className={`text-xs ${requirement.met ? 'text-text-heading' : 'text-text-secondary'}`}
            >
              {requirement.label}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 min-h-[1rem] text-xs text-text-secondary" aria-live="polite">
        {hint}
      </p>
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 px-4 py-3">
      <dt className="text-sm text-text-secondary">{label}</dt>
      <dd className="text-right text-sm font-medium text-text-heading">{value}</dd>
    </div>
  )
}

/**
 * `label` exists because this button is sometimes the last one: a ride is
 * placed from the vehicle step, and a button that says "Continue" while it
 * hails a taxi is lying about what the tap does.
 */
function NextButton({
  disabled,
  onClick,
  label = 'Continue',
  busy = false,
}: {
  disabled: boolean
  onClick: () => void
  label?: string
  busy?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-navy px-6 py-3 font-semibold text-text-on-chrome transition-[background-color,transform,opacity] duration-150 ease-[var(--kr-ease-out)] hover:bg-brand-navy-soft active:scale-[0.98] disabled:opacity-50 dark:bg-brand-green dark:hover:bg-brand-green-hover"
    >
      {busy ? 'Requesting…' : label}
      {!busy && <ArrowRight className="h-4 w-4" aria-hidden />}
    </button>
  )
}

function SuccessScreen({ reference }: { reference: string }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-surface-page px-4 text-center">
      <CheckCircle2 className="h-14 w-14 text-brand-green" aria-hidden />
      <h1 className="mt-6 font-display text-3xl font-bold tracking-tight text-text-heading">
        Order received
      </h1>
      <p className="mt-3 max-w-[40ch] text-text-secondary">
        A dispatcher will call you shortly to confirm the vehicle and the price. Your reference:
      </p>
      <p className="mt-4 rounded-xl border border-border bg-surface-card px-8 py-4 font-mono text-2xl font-bold tracking-widest text-text-heading">
        {reference}
      </p>
      <Link
        to="/"
        className="mt-8 text-sm font-medium text-brand-green transition-colors hover:text-brand-green-hover"
      >
        Back to the start
      </Link>
    </div>
  )
}
