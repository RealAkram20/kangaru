import { createBrowserRouter } from 'react-router-dom'
import { ProtectedRoute } from '../auth/ProtectedRoute'
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
      { path: 'dispatch', element: <DispatchPage /> },
      { path: 'trips', element: <TripsPage /> },
      { path: 'invoices', element: <InvoicesPage /> },
      { path: 'rate-cards', element: <RateCardsPage /> },
      { path: 'reports', element: <ReportsPage /> },
      // Reachable at /notifications, and by "See all" in the bell panel.
      // There is deliberately no SidebarNav entry yet: that file is
      // uncommitted work in progress, so adding one is the owner's call
      // once it lands (see Modules/Notifications/README.md).
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'companies', element: <CompaniesPage /> },
      { path: 'vehicles', element: <VehiclesPage /> },
      { path: 'drivers', element: <DriversPage /> },
    ],
  },
])
