import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import { CommunityRedirect } from './pages/CommunityRedirect.tsx'
import { ScrollToTop } from './components/ScrollToTop.tsx'
import { PageHead } from './components/PageHead.tsx'
import { routes } from './routes.tsx'
// Onboarding, billing, admin, and sign-in pages have been moved to the Expo web app.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        {/* Generated from the route registry (routes.tsx) — every page there
            structurally ships link-preview metadata (see PageMeta). */}
        {routes.map((route) => (
          <Route
            key={route.path}
            path={route.path}
            element={<PageHead meta={route}>{route.element}</PageHead>}
          />
        ))}
        {/* Catch-all: redirect /:slug to community landing page. Deliberately
            not in the registry — it's a redirect, not a page. */}
        <Route path="/:slug" element={<CommunityRedirect />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
