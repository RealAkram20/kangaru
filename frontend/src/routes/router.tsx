import { createBrowserRouter } from 'react-router-dom'
import { ProtectedRoute } from '../auth/ProtectedRoute'
import { RequireNavAccess } from './RequireNavAccess'
import { AppShell } from '../components/layout/AppShell'
import { BookingsPage } from '../pages/BookingsPage'
import { CompaniesPage } from '../pages/CompaniesPage'
import { DashboardPage } from '../pages/DashboardPage'
import { DispatchPage } from '../pages/DispatchPage'
import { DriversPage } from '../pages/DriversPage'
import { InvoicesPage } from '../pages/InvoicesPage'
import { LoginPage } from '../pages/LoginPage'
import { NotificationsPage } from '../pages/NotificationsPage'
import { RateCardsPage } from '../pages/RateCardsPage'
import { ReportsPage } from '../pages/ReportsPage'
import { StaffPage } from '../pages/StaffPage'
import { TripsPage } from '../pages/TripsPage'
import { VehiclesPage } from '../pages/VehiclesPage'

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'bookings', element: <BookingsPage /> },
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
      {
        path: 'staff',
        element: (
          <RequireNavAccess id="staff">
            <StaffPage />
          </RequireNavAccess>
        ),
      },
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
