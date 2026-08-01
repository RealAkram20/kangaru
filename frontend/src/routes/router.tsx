import { createBrowserRouter } from 'react-router-dom'
import { ProtectedRoute } from '../auth/ProtectedRoute'
import { AppShell } from '../components/layout/AppShell'
import { BookingsPage } from '../pages/BookingsPage'
import { CompaniesPage } from '../pages/CompaniesPage'
import { DashboardPage } from '../pages/DashboardPage'
import { DispatchPage } from '../pages/DispatchPage'
import { DriversPage } from '../pages/DriversPage'
import { LoginPage } from '../pages/LoginPage'
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
      { path: 'companies', element: <CompaniesPage /> },
      { path: 'vehicles', element: <VehiclesPage /> },
      { path: 'drivers', element: <DriversPage /> },
    ],
  },
])
