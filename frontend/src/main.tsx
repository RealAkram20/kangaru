import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import './index.css'
import { applyBrandingHead } from './lib/publicSettings'
import { router } from './routes/router'

// Title, meta description and favicon come from platform settings
// (ADR-0014). Fire-and-forget: the compiled-in defaults render first and
// the configured brand replaces them when the fetch lands.
void applyBrandingHead()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
)
