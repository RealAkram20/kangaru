import { Navigate, createBrowserRouter } from 'react-router-dom'
import { ProtectedRoute } from '../auth/ProtectedRoute'
import { RequireNavAccess } from './RequireNavAccess'
import { AppShell } from '../components/layout/AppShell'
import { Standalone } from './lazyRoute'
import { RouteBuilderPage } from '../pages/routes/RouteBuilderPage'
import { RoutesPage } from '../pages/routes/RoutesPage'
import { page } from './page'

/**
 * Every page below is code-split.
 *
 * These were 27 static imports, which meant one 1.37 MB chunk containing the
 * whole console: an anonymous visitor reading the landing page downloaded and
 * parsed SystemSettingsPage (1,713 lines) and OrderPage (2,659 lines) before
 * anything rendered. Splitting them means a route costs its own JavaScript and
 * nobody else's.
 */

const AuditLogPage = page(() => import('../pages/AuditLogPage'), 'AuditLogPage')
const BookingsPage = page(() => import('../pages/BookingsPage'), 'BookingsPage')
const CompaniesPage = page(() => import('../pages/CompaniesPage'), 'CompaniesPage')
const CustomersPage = page(() => import('../pages/CustomersPage'), 'CustomersPage')
const FleetCompaniesPage = page(() => import('../pages/FleetCompaniesPage'), 'FleetCompaniesPage')
const CorporateClientsPage = page(() => import('../pages/CorporateClientsPage'), 'CorporateClientsPage')
const PlansPage = page(() => import('../pages/PlansPage'), 'PlansPage')
const DriverContractsPage = page(() => import('../pages/DriverContractsPage'), 'DriverContractsPage')
const FleetRecordPage = page(() => import('../pages/fleets/FleetRecordPage'), 'FleetRecordPage')
const DashboardPage = page(() => import('../pages/DashboardPage'), 'DashboardPage')
const DispatchPage = page(() => import('../pages/DispatchPage'), 'DispatchPage')
const DriverApplicationsPage = page(
  () => import('../pages/DriverApplicationsPage'),
  'DriverApplicationsPage',
)
const DriversPage = page(() => import('../pages/DriversPage'), 'DriversPage')
const InvoicesPage = page(() => import('../pages/InvoicesPage'), 'InvoicesPage')
const LoginPage = page(() => import('../pages/LoginPage'), 'LoginPage')
const AcceptInvitePage = page(() => import('../pages/AcceptInvitePage'), 'AcceptInvitePage')
const MfaEnrolmentPage = page(() => import('../pages/MfaEnrolmentPage'), 'MfaEnrolmentPage')
const NotificationsPage = page(() => import('../pages/NotificationsPage'), 'NotificationsPage')
const OrderRequestsPage = page(() => import('../pages/OrderRequestsPage'), 'OrderRequestsPage')
const RateCardsPage = page(() => import('../pages/RateCardsPage'), 'RateCardsPage')
const ReportsPage = page(() => import('../pages/ReportsPage'), 'ReportsPage')
const RolesPage = page(() => import('../pages/RolesPage'), 'RolesPage')
const ProfilePage = page(() => import('../pages/ProfilePage'), 'ProfilePage')
const SystemSettingsPage = page(() => import('../pages/SystemSettingsPage'), 'SystemSettingsPage')
const StaffPage = page(() => import('../pages/StaffPage'), 'StaffPage')
const SupportRequestsPage = page(() => import('../pages/SupportRequestsPage'), 'SupportRequestsPage')
const LiveMapPage = page(() => import('../pages/LiveMapPage'), 'LiveMapPage')
const TripsPage = page(() => import('../pages/TripsPage'), 'TripsPage')
const TripRecordPage = page(() => import('../pages/trips/TripRecordPage'), 'TripRecordPage')
const DistanceReviewPage = page(
  () => import('../pages/DistanceReviewPage'),
  'DistanceReviewPage',
)
const VehiclesPage = page(() => import('../pages/VehiclesPage'), 'VehiclesPage')
const LandingPage = page(() => import('../pages/public/LandingPage'), 'LandingPage')
const OrderPage = page(() => import('../pages/public/OrderPage'), 'OrderPage')
const PrivacyNoticePage = page(
  () => import('../pages/public/PrivacyNoticePage'),
  'PrivacyNoticePage',
)

export const router = createBrowserRouter([
  // Public, unauthenticated (ADR-0012 §5). `/` is the landing page for
  // everyone, signed in or not: it is a product surface now, not a
  // doormat. Bouncing authenticated users to /dashboard meant staff could
  // never see what customers see, and a shared device would answer the
  // walk-in customer with someone else's dashboard. Staff reach theirs
  // from the nav, which says "Dashboard" once they are signed in.
  {
    path: '/',
    element: (
      <Standalone>
        <LandingPage />
      </Standalone>
    ),
  },
  {
    path: '/order',
    element: (
      <Standalone>
        <OrderPage />
      </Standalone>
    ),
  },
  // Unauthenticated by necessity, not by oversight: this is what somebody
  // reads to decide whether to hand over their data, so it cannot sit behind
  // the account that handing it over creates. master-plan.md §5 gates go-live
  // on it being readable before submission.
  {
    path: '/privacy',
    element: (
      <Standalone>
        <PrivacyNoticePage />
      </Standalone>
    ),
  },
  {
    path: '/login',
    element: (
      <Standalone>
        <LoginPage />
      </Standalone>
    ),
  },
  // Public, and standalone like /login: the reader has an account and no way
  // into it, so the shell's navigation would be a wall of links that all
  // answer 403. Mail plan M2.
  {
    path: '/invite/:token',
    element: (
      <Standalone>
        <AcceptInvitePage />
      </Standalone>
    ),
  },
  // Outside the AppShell branch on purpose (ADR-0008 decision 3). A user
  // who must enrol can reach nothing else — the shell's navigation would be
  // a wall of links that all answer 403 — so this route deliberately has no
  // sidebar to click.
  //
  // `allowUnenrolled` is what stops the guard redirecting this route to
  // itself.
  {
    path: '/mfa/setup',
    element: (
      <ProtectedRoute allowUnenrolled>
        <Standalone>
          <MfaEnrolmentPage />
        </Standalone>
      </ProtectedRoute>
    ),
  },
  // Pathless on purpose: `/` is taken by HomeGate above, and giving this
  // branch the same path would shadow it. Children still resolve from the
  // root, so every existing app URL (/bookings, /trips, …) is unchanged;
  // only the dashboard moved, from `/` to /dashboard.
  {
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { path: 'dashboard', element: <DashboardPage /> },
      // ADR-0055 / ADR-0059. Behind RequireNavAccess like Staff rather than
      // unguarded like Roles: `fleets` is not a permission a custom role is
      // expected to carry — OperatorPolicy gates on the account's LEVEL, and
      // a level is not something a role can be given. The safer side to err
      // on, and the server refuses regardless.
      // ADR-0062. Head office's client directory, behind the level gate for
      // the same reason `fleets` is: `OperatorClientPolicy` and the company
      // scope both key on `access_level`, and a level is not something a role
      // can be given.
      // ADR-0055 §5. Deliberately NOT behind RequireNavAccess: both a fleet
      // and head office reach it, and the **server** decides which queue
      // arrives. A level gate here would have to know that, which is the
      // rule living in two places.
      { path: 'driver-contracts', element: <DriverContractsPage /> },
      {
        path: 'plans',
        element: (
          <RequireNavAccess id="plans">
            <PlansPage />
          </RequireNavAccess>
        ),
      },
      {
        path: 'clients',
        element: (
          <RequireNavAccess id="clients">
            <CorporateClientsPage />
          </RequireNavAccess>
        ),
      },
      {
        path: 'fleets',
        element: (
          <RequireNavAccess id="fleets">
            <FleetCompaniesPage />
          </RequireNavAccess>
        ),
      },
      {
        path: 'fleets/:id',
        element: (
          <RequireNavAccess id="fleets">
            <FleetRecordPage />
          </RequireNavAccess>
        ),
      },
      { path: 'bookings', element: <BookingsPage /> },
      // Deliberately not behind RequireNavAccess, like Roles: a custom role
      // holding `order_requests.manage` is invisible to a slug list. The
      // page gates on whether the API answers.
      { path: 'order-requests', element: <OrderRequestsPage /> },
      {
        path: 'dispatch',
        element: (
          <RequireNavAccess id="dispatch">
            <DispatchPage />
          </RequireNavAccess>
        ),
      },
      { path: 'trips', element: <TripsPage /> },
      // One trip in full — the six facts, the photos, the trace, the
      // timeline, the invoice. Unguarded like /trips: `TripPolicy::view`
      // decides, and a client's user reads their own trips here.
      { path: 'trips/:id', element: <TripRecordPage /> },
      // ADR-0045 §2: the distance review queue. Not behind `RequireNavAccess`
      // for the reason Roles is not — the queue is `viewAny` on Trip, which a
      // custom role can hold, and the page shows whatever the API serves.
      { path: 'distance-review', element: <DistanceReviewPage /> },
      // Not behind RequireNavAccess, deliberately: /live-positions is scoped
      // server-side through the trips the caller may see, so every role gets
      // a correct answer here — a corporate employee sees their own ride,
      // and a role holding trips.view.all sees the fleet.
      { path: 'live-map', element: <LiveMapPage /> },
      // ADR-0045. Two entries for one feature: the register of circuits and
      // the builder that makes one. `/routes/new` is a literal segment ahead
      // of `:id`, so React Router matches it before treating "new" as an id.
      { path: 'routes', element: <RoutesPage /> },
      { path: 'routes/new', element: <RouteBuilderPage /> },
      { path: 'routes/:id', element: <RouteBuilderPage /> },
      {
        path: 'invoices',
        element: (
          <RequireNavAccess id="invoices">
            <InvoicesPage />
          </RequireNavAccess>
        ),
      },
      {
        path: 'rate-cards',
        element: (
          <RequireNavAccess id="rate-cards">
            <RateCardsPage />
          </RequireNavAccess>
        ),
      },
      {
        path: 'reports',
        element: (
          <RequireNavAccess id="reports">
            <ReportsPage />
          </RequireNavAccess>
        ),
      },
      // Unguarded, like Dashboard, Bookings and Trips: every account has
      // an inbox, and the server scopes each of these to the caller.
      { path: 'notifications', element: <NotificationsPage /> },
      // Unguarded for the strongest version of that reason: this page is
      // *only ever* about the signed-in user. Every endpoint it calls acts
      // on the caller and takes no user parameter, so there is no role that
      // should be turned away from their own password.
      { path: 'profile', element: <ProfilePage /> },
      // This page used to live at /settings, next to a sidebar entry of the
      // same name that meant the platform's configuration. The redirect is
      // not ceremony: /settings is in people's history and bookmarks, and
      // the alternative is a 404 on a URL that worked yesterday.
      { path: 'settings', element: <Navigate to="/profile" replace /> },
      // Platform settings (ADR-0014). Not behind RequireNavAccess, like
      // Roles: a custom role holding `settings.manage` is invisible to a
      // slug list, so the page gates on whether the API answers.
      { path: 'system-settings', element: <SystemSettingsPage /> },
      // ADR-0018. Behind RequireNavAccess like Staff, not unguarded like
      // Roles: `customers.view` is seeded on real roles rather than being a
      // permission a custom role is expected to carry, and the register is
      // members of the public — the safer side to err on.
      {
        path: 'customers',
        element: (
          <RequireNavAccess id="customers">
            <CustomersPage />
          </RequireNavAccess>
        ),
      },
      {
        path: 'staff',
        element: (
          <RequireNavAccess id="staff">
            <StaffPage />
          </RequireNavAccess>
        ),
      },
      // Deliberately unguarded, unlike Staff. RequireNavAccess decides by
      // role slug, and this page exists to create roles no slug list can
      // know about — a custom role holding `roles.manage` would be turned
      // away from the one screen built for it. The page gates on whether
      // the API answers instead, which is the rule itself rather than a
      // copy of it.
      { path: 'roles', element: <RolesPage /> },
      // Unguarded for the same reason as Roles: `audit.view` is a
      // permission, and a custom role holding it is invisible to
      // RequireNavAccess's slug list. The page gates on whether the API
      // answers.
      { path: 'audit-log', element: <AuditLogPage /> },
      // Two paths, because they are two different things. `/companies` is the
      // platform's register of many; `/company` is one client's own
      // organisation, and a bank reading its own profile at a plural URL that
      // means "everybody's clients" was always the wrong address.
      //
      // `CompaniesPage` still branches on role, so both paths stay correct for
      // whoever opens them and an old bookmark keeps working.
      {
        path: 'companies',
        element: (
          <RequireNavAccess id="companies">
            <CompaniesPage />
          </RequireNavAccess>
        ),
      },
      {
        path: 'company',
        element: (
          <RequireNavAccess id="companies">
            <CompaniesPage />
          </RequireNavAccess>
        ),
      },
      {
        path: 'vehicles',
        element: (
          <RequireNavAccess id="vehicles">
            <VehiclesPage />
          </RequireNavAccess>
        ),
      },
      {
        path: 'drivers',
        element: (
          <RequireNavAccess id="drivers">
            <DriversPage />
          </RequireNavAccess>
        ),
      },
      {
        // Deliberately NOT behind RequireNavAccess, for the same reason
        // Roles and Settings are not: `drivers.view` can live on a custom
        // role that a slug list cannot see, and the page gates on whether
        // the API answers — a 403 renders as an answer, not an apology.
        path: 'driver-applications',
        element: <DriverApplicationsPage />,
      },
      {
        // ADR-0044. Not behind `RequireNavAccess`, for the same reason the
        // applications queue above is not: `drivers.manage` can live on a
        // custom role a slug list cannot see, and the page gates on whether
        // the API answers.
        path: 'support-requests',
        element: <SupportRequestsPage />,
      },
    ],
  },
])
