import { createBrowserRouter } from 'react-router-dom'
import { ProtectedRoute } from '../auth/ProtectedRoute'
import { RequireNavAccess } from './RequireNavAccess'
import { AppShell } from '../components/layout/AppShell'
import { AuditLogPage } from '../pages/AuditLogPage'
import { BookingsPage } from '../pages/BookingsPage'
import { CompaniesPage } from '../pages/CompaniesPage'
import { DashboardPage } from '../pages/DashboardPage'
import { DispatchPage } from '../pages/DispatchPage'
import { DriversPage } from '../pages/DriversPage'
import { InvoicesPage } from '../pages/InvoicesPage'
import { LoginPage } from '../pages/LoginPage'
import { MfaEnrolmentPage } from '../pages/MfaEnrolmentPage'
import { NotificationsPage } from '../pages/NotificationsPage'
import { OrderRequestsPage } from '../pages/OrderRequestsPage'
import { RateCardsPage } from '../pages/RateCardsPage'
import { ReportsPage } from '../pages/ReportsPage'
import { RolesPage } from '../pages/RolesPage'
import { SettingsPage } from '../pages/SettingsPage'
import { SystemSettingsPage } from '../pages/SystemSettingsPage'
import { StaffPage } from '../pages/StaffPage'
import { TripsPage } from '../pages/TripsPage'
import { VehiclesPage } from '../pages/VehiclesPage'
import { LandingPage } from '../pages/public/LandingPage'
import { OrderPage } from '../pages/public/OrderPage'

export const router = createBrowserRouter([
  // Public, unauthenticated (ADR-0012 §5). `/` is the landing page for
  // everyone, signed in or not: it is a product surface now, not a
  // doormat. Bouncing authenticated users to /dashboard meant staff could
  // never see what customers see, and a shared device would answer the
  // walk-in customer with someone else's dashboard. Staff reach theirs
  // from the nav, which says "Dashboard" once they are signed in.
  {
    path: '/',
    element: <LandingPage />,
  },
  {
    path: '/order',
    element: <OrderPage />,
  },
  {
    path: '/login',
    element: <LoginPage />,
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
        <MfaEnrolmentPage />
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
      { path: 'settings', element: <SettingsPage /> },
      // Platform settings (ADR-0014). Not behind RequireNavAccess, like
      // Roles: a custom role holding `settings.manage` is invisible to a
      // slug list, so the page gates on whether the API answers.
      { path: 'system-settings', element: <SystemSettingsPage /> },
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
      {
        path: 'companies',
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
    ],
  },
])
