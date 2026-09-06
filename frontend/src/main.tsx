import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import './index.css'
import { startObservability } from './lib/observability'
import { applyBrandingHead } from './lib/publicSettings'
import { router } from './routes/router'

// Title, meta description and favicon come from platform settings
// (ADR-0014). Fire-and-forget: the compiled-in defaults render first and
// the configured brand replaces them when the fetch lands.
// ADR-0054. Before anything else renders, so a crash inside the first paint
// is still reported. Inert without VITE_SENTRY_DSN, which is how development
// and CI run.
startObservability()

void applyBrandingHead()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
)
