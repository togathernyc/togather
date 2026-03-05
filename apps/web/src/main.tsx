import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { PrivacyPolicy } from './pages/PrivacyPolicy.tsx'
import { TermsOfService } from './pages/TermsOfService.tsx'
import { AndroidDownload } from './pages/AndroidDownload.tsx'
import { Contribute } from './pages/Contribute.tsx'
import { ReportIssue } from './pages/ReportIssue.tsx'
import { ScrollToTop } from './components/ScrollToTop.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
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
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
