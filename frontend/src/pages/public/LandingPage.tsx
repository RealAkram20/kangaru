import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Building2,
  Car,
  CircleDot,
  KeyRound,
  MapPin,
  Package,
  PhoneCall,
  ShieldCheck,
} from 'lucide-react'
import { SERVICE_META, type PublicService } from './publicOrder'
import './landing.css'

/**
 * The public face of the platform (ADR-0012 §5). Layout language borrowed
 * from Uber's web landing: the order form sits in the hero and is the hero
 * visual; everything below earns its scroll. Brand stays KangaruRide's
 * green/navy token system, in both themes.
 */
export function LandingPage() {
  return (
    <div className="min-h-[100dvh] bg-surface-page text-text-body">
      <PublicNav />
      <main>
        <Hero />
        <Services />
        <HowItWorks />
        <CorporateBand />
        <AppPreview />
      </main>
      <PublicFooter />
    </div>
  )
}

function PublicNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface-page/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <img src="/assets/logo-mark.png" alt="" className="h-8 w-8" />
          <span className="font-display text-lg font-bold text-text-heading">
            Kangaru<span className="text-brand-green">Ride</span>
          </span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-4">
          <Link
            to="/login"
            className="rounded-lg px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-heading"
          >
            Log in
          </Link>
          <Link
            to="/order"
            className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-text-on-brand transition-all hover:bg-brand-green-hover active:scale-[0.98]"
          >
            Order now
          </Link>
        </nav>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16 lg:pb-24 lg:pt-20">
      <div className="kr-rise">
        <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-text-heading md:text-5xl lg:text-6xl">
          Go anywhere.
          <br />
          Send anything.
        </h1>
        <p className="mt-5 max-w-[42ch] text-lg text-text-secondary">
          Rides, deliveries and self-drive rentals across Kampala, run by one fleet you can call.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            to="/order"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-green px-6 py-3 font-semibold text-text-on-brand transition-all hover:bg-brand-green-hover active:scale-[0.98]"
          >
            Order now
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <span className="inline-flex items-center gap-2 text-sm text-text-secondary">
            <ShieldCheck className="h-4 w-4 text-brand-green" aria-hidden />
            For Safety and Reliability
          </span>
        </div>
      </div>
      <HeroQuickForm />
    </section>
  )
}

/**
 * The Uber move: the first thing a visitor can *do* sits inside the hero.
 * It collects the trip's two ends and hands off to /order with them
 * prefilled, so the flow starts one step in.
 */
function HeroQuickForm() {
  const navigate = useNavigate()
  const [service, setService] = useState<PublicService>('ride')
  const [pickup, setPickup] = useState('')
  const [dropoff, setDropoff] = useState('')

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const params = new URLSearchParams({ service })
    if (pickup.trim()) params.set('pickup', pickup.trim())
    if (dropoff.trim()) params.set('dropoff', dropoff.trim())
    navigate(`/order?${params.toString()}`)
  }

  return (
    <form
      onSubmit={submit}
      className="kr-rise kr-rise-delay-1 rounded-2xl border border-border bg-surface-card p-6 shadow-sm"
    >
      <div className="flex gap-2" role="tablist" aria-label="Service">
        {(Object.keys(SERVICE_META) as PublicService[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={service === key}
            onClick={() => setService(key)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              service === key
                ? 'bg-brand-green text-text-on-brand'
                : 'bg-surface-sunken text-text-secondary hover:text-text-heading'
            }`}
          >
            {SERVICE_META[key].label}
          </button>
        ))}
      </div>

      {service === 'self_drive' ? (
        <p className="mt-6 text-sm text-text-secondary">
          Pick a vehicle and your dates on the next step.
        </p>
      ) : (
        <div className="mt-6 space-y-3">
          <label className="flex items-center gap-3 rounded-lg border border-border-input bg-surface-page px-4 py-3 transition-colors focus-within:border-brand-green">
            <CircleDot className="h-4 w-4 shrink-0 text-brand-green" aria-hidden />
            <span className="sr-only">Pickup location</span>
            <input
              value={pickup}
              onChange={(e) => setPickup(e.target.value)}
              placeholder="Pickup location"
              className="w-full bg-transparent text-text-body outline-none placeholder:text-text-placeholder"
            />
          </label>
          <label className="flex items-center gap-3 rounded-lg border border-border-input bg-surface-page px-4 py-3 transition-colors focus-within:border-brand-green">
            <MapPin className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
            <span className="sr-only">Drop-off location</span>
            <input
              value={dropoff}
              onChange={(e) => setDropoff(e.target.value)}
              placeholder="Where is it going?"
              className="w-full bg-transparent text-text-body outline-none placeholder:text-text-placeholder"
            />
          </label>
        </div>
      )}

      <button
        type="submit"
        className="mt-5 w-full rounded-lg bg-brand-navy px-6 py-3 font-semibold text-text-on-chrome transition-all hover:bg-brand-navy-soft active:scale-[0.98] dark:bg-brand-green dark:hover:bg-brand-green-hover"
      >
        Continue
      </button>
      <p className="mt-3 text-center text-xs text-text-secondary">
        No account needed. A dispatcher confirms every order by phone.
      </p>
    </form>
  )
}

function Services() {
  return (
    <section className="border-t border-border bg-surface-sunken">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <h2 className="font-display text-2xl font-bold tracking-tight text-text-heading md:text-3xl">
          One fleet, three ways to use it
        </h2>
        <div className="mt-10 grid gap-4 lg:grid-cols-[3fr_2fr]">
          <ServiceCard
            service="ride"
            icon={<Car className="h-6 w-6" aria-hidden />}
            detail="Economy cars to boda bodas. Immediate or scheduled."
            className="relative isolate overflow-hidden bg-brand-navy text-white lg:row-span-2"
            dark
            background={
              <>
                <img
                  src="/assets/landing-night-road.jpg"
                  alt=""
                  className="absolute inset-0 -z-20 h-full w-full object-cover"
                  loading="lazy"
                />
                {/* Navy scrim, heaviest where the text sits: solid at the
                    bottom and left, letting the light trails read top-right. */}
                <div
                  className="absolute inset-0 -z-10"
                  style={{
                    background:
                      'linear-gradient(to top, var(--kr-navy) 12%, rgba(0,16,40,0.82) 55%, rgba(0,16,40,0.55) 100%)',
                  }}
                  aria-hidden
                />
              </>
            }
            body={
              <ul className="space-y-3 text-sm">
                {[
                  ['Boda Boda', 'from UGX 5,000'],
                  ['Economy', 'from UGX 12,500'],
                  ['Standard', 'from UGX 16,500'],
                  ['XL, up to 6 seats', 'from UGX 22,000'],
                ].map(([klass, fare]) => (
                  <li key={klass} className="flex items-baseline justify-between gap-4">
                    <span className="text-white/80">{klass}</span>
                    <span className="font-mono text-white">{fare}</span>
                  </li>
                ))}
              </ul>
            }
          />
          <ServiceCard
            service="delivery"
            icon={<Package className="h-6 w-6" aria-hidden />}
            detail="Documents to heavy cargo. The receiver can confirm with a PIN."
            className="bg-surface-card"
          />
          <ServiceCard
            service="self_drive"
            icon={<KeyRound className="h-6 w-6" aria-hidden />}
            detail="Sedans, SUVs and vans by the day, insured and serviced."
            className="bg-surface-accent"
          />
        </div>
      </div>
    </section>
  )
}

function ServiceCard({
  service,
  icon,
  detail,
  className,
  dark = false,
  body,
  background,
}: {
  service: PublicService
  icon: React.ReactNode
  detail: string
  className?: string
  dark?: boolean
  body?: React.ReactNode
  background?: React.ReactNode
}) {
  return (
    <Link
      to={`/order?service=${service}`}
      className={`group flex flex-col justify-between gap-8 rounded-2xl border border-border p-6 transition-all hover:-translate-y-0.5 hover:shadow-md lg:p-8 ${className ?? ''}`}
    >
      {background}
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-xl ${
          dark ? 'bg-white/10 text-white' : 'bg-brand-green-tint text-brand-green'
        }`}
      >
        {icon}
      </div>
      {body !== undefined && <div className="my-2">{body}</div>}
      <div>
        <h3
          className={`font-display text-xl font-semibold ${dark ? 'text-white' : 'text-text-heading'}`}
        >
          {SERVICE_META[service].label}
        </h3>
        <p
          className={`mt-2 text-sm leading-relaxed ${dark ? 'text-white/70' : 'text-text-secondary'}`}
        >
          {detail}
        </p>
        <span
          className={`mt-4 inline-flex items-center gap-1 text-sm font-medium ${
            dark ? 'text-white' : 'text-brand-green'
          }`}
        >
          Start an order
          <ArrowRight
            className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </span>
      </div>
    </Link>
  )
}

function HowItWorks() {
  const steps = [
    {
      icon: <MapPin className="h-5 w-5" aria-hidden />,
      title: 'Tell us the trip',
      body: 'Where from, where to, and when. Two minutes, no account.',
    },
    {
      icon: <PhoneCall className="h-5 w-5" aria-hidden />,
      title: 'We call to confirm',
      body: 'A dispatcher rings you back with the vehicle and the price.',
    },
    {
      icon: <Car className="h-5 w-5" aria-hidden />,
      title: 'Your driver arrives',
      body: 'Tracked from our dispatch desk, door to door.',
    },
  ]

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
      <h2 className="font-display text-2xl font-bold tracking-tight text-text-heading md:text-3xl">
        How ordering works
      </h2>
      <ol className="mt-10 grid gap-8 md:grid-cols-3">
        {steps.map((step) => (
          <li key={step.title} className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-green-tint text-brand-green">
              {step.icon}
            </div>
            <div>
              <h3 className="font-semibold text-text-heading">{step.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-text-secondary">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function CorporateBand() {
  return (
    <section className="bg-brand-navy">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center lg:py-20">
        <div>
          <h2 className="font-display text-2xl font-bold tracking-tight text-white md:text-3xl">
            Running transport for a company?
          </h2>
          <p className="mt-4 max-w-[48ch] text-white/70">
            Corporate clients get their own dashboard: bookings, trip records with odometer photos,
            monthly invoicing and a full audit log.
          </p>
        </div>
        <div className="flex flex-col gap-6">
          <img
            src="/assets/landing-aerial-roads.jpg"
            alt="An aerial view of a highway interchange"
            className="hidden max-h-56 w-full rounded-2xl object-cover lg:block"
            loading="lazy"
          />
          <div>
            <a
              href="mailto:operations@kangaruride.com?subject=Corporate%20account"
              className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 font-semibold text-brand-navy transition-all hover:bg-white/90 active:scale-[0.98]"
            >
              <Building2 className="h-4 w-4" aria-hidden />
              Talk to our team
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

function AppPreview() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
      <div className="order-2 lg:order-1">
        {/* The mockup PNG carries its own white ground, so it sits on a
            deliberate white card rather than bleeding into dark mode. */}
        {/* Eager, with the aspect ratio reserved: lazy-loading left this
            collapsed to an empty pill until the image arrived (CLS). */}
        <div className="mx-auto w-full max-w-[320px] rounded-3xl border border-border bg-white p-4 shadow-sm">
          <img
            src="/assets/app-home-preview.png"
            alt="The KangaruRide app home screen, showing Ride, Deliver and Self Drive"
            className="aspect-[853/1844] w-full object-contain"
          />
        </div>
      </div>
      <div className="order-1 lg:order-2">
        <h2 className="font-display text-2xl font-bold tracking-tight text-text-heading md:text-3xl">
          The app is on its way
        </h2>
        <p className="mt-4 max-w-[48ch] text-text-secondary">
          Live tracking, wallets and in-app ordering are coming. Until then, every order placed here
          is handled by the same dispatch desk that runs our corporate fleet.
        </p>
        <Link
          to="/order"
          className="mt-6 inline-flex items-center gap-2 font-semibold text-brand-green transition-colors hover:text-brand-green-hover"
        >
          Order on the web today
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </section>
  )
}

function PublicFooter() {
  return (
    <footer className="border-t border-border bg-surface-sunken">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <img src="/assets/logo-mark.png" alt="" className="h-6 w-6" />
          <span className="text-sm text-text-secondary">
            Shanitah General Enterprises Ltd · Kampala
          </span>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-text-secondary">
          <Link to="/order" className="transition-colors hover:text-text-heading">
            Place an order
          </Link>
          <Link to="/login" className="transition-colors hover:text-text-heading">
            Corporate dashboard
          </Link>
          <a
            href="mailto:operations@kangaruride.com"
            className="transition-colors hover:text-text-heading"
          >
            operations@kangaruride.com
          </a>
        </nav>
      </div>
    </footer>
  )
}
