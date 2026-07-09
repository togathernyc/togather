import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { PrivacyPolicy } from './pages/PrivacyPolicy.tsx'
import { TermsOfService } from './pages/TermsOfService.tsx'
import { AndroidDownload } from './pages/AndroidDownload.tsx'
import { Contribute } from './pages/Contribute.tsx'
import { ContributeAI } from './pages/ContributeAI.tsx'
import { ReportIssue } from './pages/ReportIssue.tsx'
import { CommunityRedirect } from './pages/CommunityRedirect.tsx'
import { Developers } from './pages/Developers.tsx'
import { Guides } from './pages/Guides.tsx'
import { CreateCommunity } from './pages/guides/CreateCommunity.tsx'
import { Pricing } from './pages/guides/Pricing.tsx'
import { Branding } from './pages/guides/Branding.tsx'
import { GroupTypes } from './pages/guides/GroupTypes.tsx'
import { GroupsAndChannels } from './pages/guides/GroupsAndChannels.tsx'
import { Events } from './pages/guides/Events.tsx'
import { EventPlans } from './pages/guides/EventPlans.tsx'
import { CheckIn } from './pages/guides/CheckIn.tsx'
import { Prayer } from './pages/guides/Prayer.tsx'
import { ScrollToTop } from './components/ScrollToTop.tsx'
// Onboarding, billing, admin, and sign-in pages have been moved to the Expo web app.

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/android" element={<AndroidDownload />} />
        <Route path="/android-staging" element={<AndroidDownload variant="staging" />} />
        <Route path="/contribute" element={<Contribute />} />
        <Route path="/contribute/ai" element={<ContributeAI />} />
        <Route path="/issue" element={<ReportIssue />} />
        <Route path="/guides" element={<Guides />} />
        <Route path="/guides/create-your-community" element={<CreateCommunity />} />
        <Route path="/guides/pricing" element={<Pricing />} />
        <Route path="/guides/branding" element={<Branding />} />
        <Route path="/guides/group-types" element={<GroupTypes />} />
        <Route path="/guides/groups-and-channels" element={<GroupsAndChannels />} />
        <Route path="/guides/events" element={<Events />} />
        <Route path="/guides/event-plans" element={<EventPlans />} />
        <Route path="/guides/check-in" element={<CheckIn />} />
        <Route path="/guides/prayer" element={<Prayer />} />
        <Route path="/legal/privacy" element={<PrivacyPolicy />} />
        <Route path="/legal/terms" element={<TermsOfService />} />
        {/* Browser-only developer docs (excluded from app links — see worker) */}
        <Route path="/developers" element={<Developers />} />
        {/* Catch-all: redirect /:slug to community landing page */}
        <Route path="/:slug" element={<CommunityRedirect />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
