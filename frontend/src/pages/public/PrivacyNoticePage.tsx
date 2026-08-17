import {
  Clock,
  Database,
  MapPin,
  ScrollText,
  Share2,
  ShieldCheck,
  Smartphone,
  UserCheck,
} from 'lucide-react'
import type { ReactNode } from 'react'

import { PublicFooter, PublicNav } from './LandingPage'

/**
 * What happens to a customer's data, readable before they hand it over.
 *
 * `docs/master-plan.md` §5 gates go-live on one sentence — *"Privacy notice
 * readable before a customer submits an order"* — because §1 decision 1 put
 * members of the public on the platform, and the Uganda **Data Protection and
 * Privacy Act, 2019** applies from that moment. `docs/data-inventory.md` is the
 * long form; this page is the half a customer is owed.
 *
 * ## Every claim here is checked against code, not written from memory
 *
 * The section that would be missing from a notice written from intuition is
 * **"Who else sees it"**. The address box sends what is typed to a geocoder as
 * it is typed, and the map centres on the pickup through Google. Those are
 * transfers to third parties that happen *before* anything is submitted, and a
 * notice that omits them is wrong in the way that matters.
 *
 * Equally deliberate is what the page **declines** to claim: rental identity
 * documents never leave the device (`OrderPage.tsx` sends
 * `Object.keys(kycFiles)` — the document *names* — and never the files), so
 * this page says so rather than staying silent and letting a reader assume the
 * worse and commoner thing.
 *
 * ## Retention states policy, and the policy is not yet automated
 *
 * The periods in "How long we keep it" are the written policy from
 * `AGENTS.md` Compliance. `data-inventory.md` §6.1 records that **only one of
 * the four is enforced by a scheduled job today**. That gap is the owner's to
 * close or to reword; it is recorded there and in the worklog rather than
 * quietly softened here, because a notice that hedges every period tells a
 * customer nothing at all.
 */
export function PrivacyNoticePage() {
  return (
    <div className="min-h-[100dvh] bg-surface-page text-text-body">
      <PublicNav />

      <main className="mx-auto max-w-3xl px-4 pb-20 pt-10 sm:px-6 lg:pt-16">
        <header>
          <span className="inline-flex items-center gap-2 rounded-full bg-surface-accent px-3 py-1 text-xs font-semibold text-brand-green">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Your data
          </span>
          <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-text-heading sm:text-4xl">
            What we do with your information
          </h1>
          <p className="mt-4 text-lg text-text-secondary">
            Read this before you order. It says what we collect, who else sees it, and how long we
            keep it — in the order those things actually happen.
          </p>
        </header>

        {/*
          The controller's legal identity, first and unmissable. A notice that
          does not say who is answerable for the data is not a notice; it is
          reassurance. The name matches the footer, which is the same entity.
        */}
        <section className="mt-8 rounded-2xl border border-border bg-surface-card p-5 sm:p-6">
          <h2 className="font-display text-base font-semibold text-text-heading">
            Who is responsible
          </h2>
          <p className="mt-2 text-text-secondary">
            <span className="text-text-body">Shanitah General Enterprises Ltd</span>, Kampala,
            Uganda, trading as KangaruRide. We decide what is collected and why, which makes us
            answerable for it under the Data Protection and Privacy Act, 2019.
          </p>
          <p className="mt-3 text-text-secondary">
            Questions, or a request about your own data:{' '}
            <a
              className="font-medium text-brand-green underline underline-offset-4 transition-colors hover:text-brand-green-hover"
              href="mailto:operations@kangaruride.com"
            >
              operations@kangaruride.com
            </a>
          </p>
        </section>

        <Section icon={<Database aria-hidden />} title="What we collect, and why">
          <Row label="Your name, phone and email">
            The driver needs to know who to meet, and the office needs to reach you if a pickup
            fails. Email is also how you sign in.
          </Row>
          <Row label="Pickup and drop-off addresses">
            The trip cannot happen without them. We also store their coordinates, so the nearest
            driver is offered the job rather than a distant one.
          </Row>
          <Row label="Anything you type in the notes box">
            It reaches the dispatcher exactly as written. Please do not put anything there you would
            not want a person at the office to read.
          </Row>
          <Row label="The other person's name and phone, for a delivery or a ride you book for someone else">
            The driver has to be able to ring both ends.{' '}
            <span className="text-text-body">
              If you give us someone else&apos;s number, please tell them
            </span>{' '}
            — they have not read this page.
          </Row>
          <Row label="Where the driver is, during your trip">
            The vehicle&apos;s position is recorded while the trip runs. It measures the distance
            your fare is based on, and it is what lets the office find the car.
          </Row>
        </Section>

        {/*
          The section a notice written from memory would not contain. Every
          recipient below was verified by reading the request that performs the
          transfer — see data-inventory.md §5 for the file and line of each.
        */}
        <Section icon={<Share2 aria-hidden />} title="Who else sees it">
          <p className="text-text-secondary">
            We do not sell your data and we run no advertising or analytics trackers. Some of it
            does reach other companies, because the map and the address search are theirs:
          </p>
          <Row label="The address search — as you type">
            Each keystroke in the pickup or drop-off box is sent to a mapping service to turn it
            into a place. <span className="text-text-body">This happens before you submit</span>,
            and it happens even if you then abandon the order.
          </Row>
          <Row label="The map">
            Loading the map tells the map provider roughly where you are looking, which is normally
            your pickup point.
          </Row>
          <Row label="Google, only if you choose to sign in with Google">
            Then Google confirms your email and name to us. If you sign up with a password instead,
            Google is not involved in your account.
          </Row>
        </Section>

        <Section icon={<Smartphone aria-hidden />} title="What stays on your phone">
          <p className="text-text-secondary">
            Your recent destinations and any drivers you marked as favourite are kept in your own
            browser. They are not sent to us and we cannot read them. Clearing your browser&apos;s
            site data removes both.
          </p>
        </Section>

        {/*
          Stated rather than left silent. A customer who has just photographed
          their national ID for a rental will assume it was uploaded — that is
          the reasonable assumption, and it is wrong. Saying so is worth more
          than the sentence costs.
        */}
        <Section icon={<UserCheck aria-hidden />} title="What we do not collect">
          <Row label="Your identity documents, when you rent a self-drive vehicle">
            The photographs you attach stay on your device. We are told only{' '}
            <span className="text-text-body">which</span> documents you have ready — so the desk
            knows the rental can be collected — never the documents themselves.
          </Row>
          <Row label="Your details, by a driver who has not accepted your trip">
            Your name and number are released to a driver at the moment they accept, and not before.
          </Row>
        </Section>

        <Section icon={<Clock aria-hidden />} title="How long we keep it">
          <Row label="Trip and order records — 7 years">
            They are financial records. An invoice has to be reproducible years later, which is the
            promise our corporate clients buy.
          </Row>
          <Row label="The GPS trace of a trip — 12 months">
            Long enough to settle a dispute about a route or a distance, and no longer.
          </Row>
          <Row label="Your account — until you close it">
            Ask us and we will close it. The trips already invoiced stay, because we are required to
            keep those.
          </Row>
        </Section>

        <Section icon={<MapPin aria-hidden />} title="Your rights">
          <p className="text-text-secondary">
            Under the Data Protection and Privacy Act, 2019 you may ask what we hold about you, ask
            us to correct it, and ask us to delete it where we are not required to keep it. Write to{' '}
            <a
              className="font-medium text-brand-green underline underline-offset-4 transition-colors hover:text-brand-green-hover"
              href="mailto:operations@kangaruride.com"
            >
              operations@kangaruride.com
            </a>{' '}
            and we will answer.
          </p>
        </Section>

        <p className="mt-10 flex items-start gap-2 border-t border-border pt-6 text-sm text-text-secondary">
          <ScrollText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            Last updated 18 August 2026. If this changes in a way that affects you, we will say so
            here before it takes effect.
          </span>
        </p>
      </main>

      <PublicFooter />
    </div>
  )
}

/**
 * The one line that makes the notice reachable *before* somebody submits.
 *
 * Exported from this module rather than living in a `ui/` folder so that the
 * pointer and the page it points at are edited together — a link to a notice
 * that no longer says what the link claims is the failure mode here.
 *
 * ## Two decisions worth not undoing
 *
 * **It opens in a new tab.** `OrderPage` holds the entire order in React state
 * with nothing in the URL, so navigating to `/privacy` and back would destroy
 * a part-finished order. A notice that costs somebody their order is a notice
 * nobody opens, and the go/no-go gate would be met on paper only.
 *
 * **It is a sentence, not a tick-box.** The Act's requirement is that the data
 * subject be *informed*. A consent checkbox on a form somebody must complete to
 * get a taxi is not freely given consent — it adds a tap to every order and
 * buys a protection it does not actually provide.
 */
export function PrivacyLine() {
  return (
    <p className="mt-3 text-center text-xs text-text-secondary">
      Your name, phone and addresses are used to run this trip.{' '}
      <a
        href="/privacy"
        target="_blank"
        rel="noreferrer"
        className="font-medium text-brand-green underline underline-offset-4 transition-colors hover:text-brand-green-hover"
      >
        What we do with your data
      </a>
    </p>
  )
}

/**
 * One titled block. The icon is decorative — the heading carries the meaning,
 * so it is `aria-hidden` and the section is found by its text.
 */
function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2.5 font-display text-xl font-bold text-text-heading">
        <span className="text-brand-green [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
        {title}
      </h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

/**
 * A labelled paragraph rather than a bullet: the label is the thing being
 * described and the sentence under it is why we have it. A reader scanning for
 * "what happens to my address" finds the label without reading the prose.
 */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface-card p-4 sm:p-5">
      <p className="font-semibold text-text-heading">{label}</p>
      <p className="mt-1.5 text-text-secondary">{children}</p>
    </div>
  )
}
