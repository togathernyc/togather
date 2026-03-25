import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ConvexProvider } from 'convex/react'
import { convex } from './lib/convex'
import './index.css'
import App from './App.tsx'
import { PrivacyPolicy } from './pages/PrivacyPolicy.tsx'
import { TermsOfService } from './pages/TermsOfService.tsx'
import { AndroidDownload } from './pages/AndroidDownload.tsx'
import { Contribute } from './pages/Contribute.tsx'
import { ReportIssue } from './pages/ReportIssue.tsx'
import { CommunityRedirect } from './pages/CommunityRedirect.tsx'
import SignIn from './pages/SignIn.tsx'
import ProposeCommunity from './pages/ProposeCommunity.tsx'
import CommunitySetup from './pages/CommunitySetup.tsx'
import OnboardingSuccess from './pages/OnboardingSuccess.tsx'
import AdminProposals from './pages/AdminProposals.tsx'
import BillingManagement from './pages/BillingManagement.tsx'
import { ScrollToTop } from './components/ScrollToTop.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/android" element={<AndroidDownload />} />
          <Route path="/android-staging" element={<AndroidDownload variant="staging" />} />
          <Route path="/contribute" element={<Contribute />} />
          <Route path="/issue" element={<ReportIssue />} />
          <Route path="/legal/privacy" element={<PrivacyPolicy />} />
          <Route path="/legal/terms" element={<TermsOfService />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/onboarding/signin" element={<SignIn />} />
          <Route path="/onboarding/proposal" element={<ProposeCommunity />} />
          <Route path="/onboarding/setup" element={<CommunitySetup />} />
          <Route path="/onboarding/success" element={<OnboardingSuccess />} />
          <Route path="/admin/proposals" element={<AdminProposals />} />
          <Route path="/billing/:communityId" element={<BillingManagement />} />
          {/* Catch-all: redirect /:slug to community landing page */}
          <Route path="/:slug" element={<CommunityRedirect />} />
        </Routes>
      </BrowserRouter>
    </ConvexProvider>
  </StrictMode>,
)
