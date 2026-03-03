/**
 * API Route for Landing Page
 *
 * Serves the static HTML landing page for the root domain (togather.nyc).
 * Subdomain requests (e.g., fount.togather.nyc) fall through to the page component.
 *
 * This gives instant page loads without JavaScript hydration overhead.
 */

import { DOMAIN_CONFIG } from "@togather/shared";

/**
 * Generate the complete landing page HTML with inlined CSS and JS
 */
function generateLandingPageHtml(): string {
  const landingUrl = DOMAIN_CONFIG.landingUrl;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Togather - Connect Your Community</title>
  <meta name="description" content="Togather brings your groups, messaging, and events together in one place. The all-in-one platform for churches and communities.">
  <meta name="theme-color" content="#D4A574">

  <!-- Open Graph -->
  <meta property="og:title" content="Togather - Connect Your Community">
  <meta property="og:description" content="Togather brings your groups, messaging, and events together in one place. The all-in-one platform for churches and communities.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${landingUrl}">
  <meta property="og:image" content="${landingUrl}/og-image.png">

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Togather - Connect Your Community">
  <meta name="twitter:description" content="Togather brings your groups, messaging, and events together in one place.">

  <!-- Preconnect for fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">

  <style>
/* CSS Variables */
:root {
  --color-bg: #FDF8F3;
  --color-bg-alt: #F9F3ED;
  --color-primary: #D4A574;
  --color-primary-dark: #C4956A;
  --color-primary-light: #E8C9A8;
  --color-text: #2D2A26;
  --color-text-muted: #6B6560;
  --color-text-light: #9A958F;
  --color-border: #E8E3DD;
  --color-white: #FFFFFF;
  --color-success: #5A9A6E;
  --font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;
  --font-size-2xl: 1.5rem;
  --font-size-3xl: 2rem;
  --font-size-4xl: 2.5rem;
  --font-size-5xl: 3.5rem;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;
  --space-16: 4rem;
  --space-20: 5rem;
  --container-max: 1200px;
  --container-narrow: 800px;
  --header-height: 72px;
  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-full: 9999px;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.08);
  --transition-fast: 150ms ease;
  --transition-base: 200ms ease;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; -webkit-font-smoothing: antialiased; }
body { font-family: var(--font-family); font-size: var(--font-size-base); line-height: 1.6; color: var(--color-text); background-color: var(--color-bg); }
img, svg { display: block; max-width: 100%; }
a { color: inherit; text-decoration: none; }
button { font-family: inherit; cursor: pointer; border: none; background: none; }
ul, ol { list-style: none; }

.skip-link { position: absolute; top: -100%; left: 50%; transform: translateX(-50%); padding: var(--space-3) var(--space-6); background: var(--color-text); color: var(--color-white); border-radius: var(--radius-md); z-index: 1000; transition: top var(--transition-fast); }
.skip-link:focus { top: var(--space-4); }

.container { width: 100%; max-width: var(--container-max); margin: 0 auto; padding: 0 var(--space-6); }

.header { position: fixed; top: 0; left: 0; right: 0; height: var(--header-height); background: rgba(253, 248, 243, 0.95); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-bottom: 1px solid var(--color-border); z-index: 100; }
.nav { display: flex; align-items: center; justify-content: space-between; height: 100%; }
.logo { display: flex; align-items: center; gap: var(--space-3); font-weight: 600; font-size: var(--font-size-xl); color: var(--color-text); }
.logo-icon { width: 36px; height: 36px; color: var(--color-primary); }
.nav-links { display: none; gap: var(--space-8); }
.nav-links a { font-size: var(--font-size-sm); font-weight: 500; color: var(--color-text-muted); transition: color var(--transition-fast); }
.nav-links a:hover { color: var(--color-text); }
.nav-cta { display: none; }

.mobile-menu-btn { display: flex; flex-direction: column; justify-content: center; gap: 5px; width: 32px; height: 32px; padding: 4px; }
.mobile-menu-btn span { display: block; width: 100%; height: 2px; background: var(--color-text); border-radius: 2px; transition: var(--transition-fast); }
.mobile-menu-btn[aria-expanded="true"] span:nth-child(1) { transform: rotate(45deg) translate(5px, 5px); }
.mobile-menu-btn[aria-expanded="true"] span:nth-child(2) { opacity: 0; }
.mobile-menu-btn[aria-expanded="true"] span:nth-child(3) { transform: rotate(-45deg) translate(5px, -5px); }
.mobile-menu { display: none; position: fixed; top: var(--header-height); left: 0; right: 0; background: var(--color-bg); border-bottom: 1px solid var(--color-border); padding: var(--space-6); flex-direction: column; gap: var(--space-4); z-index: 99; }
.mobile-menu.active { display: flex; }
.mobile-menu a { font-size: var(--font-size-lg); font-weight: 500; padding: var(--space-3) 0; }

@media (min-width: 768px) {
  .nav-links { display: flex; }
  .nav-cta { display: block; }
  .mobile-menu-btn, .mobile-menu { display: none !important; }
}

.btn { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); padding: var(--space-3) var(--space-6); font-size: var(--font-size-sm); font-weight: 600; border-radius: var(--radius-full); transition: all var(--transition-fast); white-space: nowrap; }
.btn-primary { background: var(--color-primary); color: var(--color-white); }
.btn-primary:hover { background: var(--color-primary-dark); transform: translateY(-1px); box-shadow: var(--shadow-md); }
.btn-secondary { background: var(--color-white); color: var(--color-text); border: 1px solid var(--color-border); }
.btn-secondary:hover { background: var(--color-bg-alt); border-color: var(--color-text-light); }
.btn-lg { padding: var(--space-4) var(--space-8); font-size: var(--font-size-base); }
.btn-icon { width: 18px; height: 18px; }

.hero { padding: calc(var(--header-height) + var(--space-12)) 0 var(--space-16); min-height: 100vh; display: flex; align-items: center; }
.hero-content { text-align: center; }
.hero-badge { display: inline-flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-4); background: var(--color-white); border: 1px solid var(--color-border); border-radius: var(--radius-full); font-size: var(--font-size-sm); color: var(--color-text-muted); margin-bottom: var(--space-8); }
.badge-dot { width: 8px; height: 8px; background: var(--color-success); border-radius: 50%; animation: pulse 2s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
.hero-title { font-size: var(--font-size-4xl); font-weight: 700; line-height: 1.1; margin-bottom: var(--space-6); letter-spacing: -0.02em; }
.hero-title .highlight { color: var(--color-primary); display: block; }
.hero-subtitle { font-size: var(--font-size-lg); color: var(--color-text-muted); max-width: 540px; margin: 0 auto var(--space-8); line-height: 1.7; }
.hero-cta { display: flex; flex-direction: column; gap: var(--space-4); margin-bottom: var(--space-10); }
.hero-badges { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-6); }
.trust-badge { display: flex; align-items: center; gap: var(--space-2); font-size: var(--font-size-sm); color: var(--color-text-muted); }
.trust-badge svg { width: 18px; height: 18px; color: var(--color-primary); }

.hero-visual { display: none; justify-content: center; margin-top: var(--space-12); }
.phone-mockup { width: 280px; height: 560px; background: var(--color-text); border-radius: 40px; padding: 12px; box-shadow: var(--shadow-lg); }
.phone-screen { width: 100%; height: 100%; background: var(--color-white); border-radius: 32px; overflow: hidden; }

.app-preview-map { position: relative; width: 100%; height: 100%; background: #E8E4DF; overflow: hidden; }
.map-bg { position: absolute; inset: 0; background: linear-gradient(135deg, #E8E4DF 0%, #D8D4CF 100%); }
.map-road { position: absolute; background: rgba(255, 255, 255, 0.6); border-radius: 2px; }
.map-road-1 { width: 80%; height: 8px; top: 30%; left: 10%; }
.map-road-2 { width: 8px; height: 60%; top: 20%; left: 40%; }
.map-road-3 { width: 60%; height: 8px; top: 55%; left: 25%; transform: rotate(-15deg); }
.map-pin { position: absolute; width: 32px; height: 32px; color: var(--color-primary); filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2)); animation: pin-bounce 2s ease-in-out infinite; }
.map-pin svg { width: 100%; height: 100%; }
.pin-1 { top: 20%; left: 25%; animation-delay: 0s; }
.pin-2 { top: 35%; left: 60%; animation-delay: 0.3s; }
.pin-3 { top: 50%; left: 35%; animation-delay: 0.6s; }
@keyframes pin-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
.explore-card { position: absolute; bottom: 0; left: 0; right: 0; background: var(--color-white); border-radius: 20px 20px 0 0; padding: var(--space-4); box-shadow: 0 -4px 20px rgba(0,0,0,0.1); }
.explore-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-3); padding-bottom: var(--space-3); border-bottom: 1px solid var(--color-border); }
.explore-title { font-weight: 600; font-size: var(--font-size-sm); color: var(--color-text); }
.explore-count { font-size: var(--font-size-xs); color: var(--color-text-muted); }
.explore-item { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) 0; }
.explore-avatar { width: 36px; height: 36px; background: var(--color-primary-light); border-radius: var(--radius-sm); }
.explore-avatar.alt { background: #A8D4C8; }
.explore-info { flex: 1; }
.explore-name { font-size: var(--font-size-sm); font-weight: 500; color: var(--color-text); }
.explore-meta { font-size: var(--font-size-xs); color: var(--color-text-muted); }

@media (min-width: 640px) { .hero-cta { flex-direction: row; justify-content: center; } }
@media (min-width: 768px) { .hero-title { font-size: var(--font-size-5xl); } .hero-title .highlight { display: inline; } .hero-visual { display: flex; } }
@media (min-width: 1024px) { .hero { padding-top: var(--header-height); } .hero .container { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-12); align-items: center; } .hero-content { text-align: left; } .hero-subtitle { margin: 0 0 var(--space-8); } .hero-cta { justify-content: flex-start; } .hero-badges { justify-content: flex-start; } .hero-visual { margin-top: 0; order: 1; } }

.section-header { text-align: center; max-width: var(--container-narrow); margin: 0 auto var(--space-12); }
.section-title { font-size: var(--font-size-3xl); font-weight: 700; margin-bottom: var(--space-4); letter-spacing: -0.02em; }
.section-subtitle { font-size: var(--font-size-lg); color: var(--color-text-muted); line-height: 1.7; }
@media (min-width: 768px) { .section-title { font-size: var(--font-size-4xl); } }

.features { padding: var(--space-20) 0; background: var(--color-white); }
.features-grid { display: grid; gap: var(--space-8); }
.feature-card { padding: var(--space-6); background: var(--color-bg); border-radius: var(--radius-lg); transition: transform var(--transition-base), box-shadow var(--transition-base); }
.feature-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-md); }
.feature-icon { width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; background: var(--color-primary-light); border-radius: var(--radius-md); margin-bottom: var(--space-4); }
.feature-icon svg { width: 24px; height: 24px; color: var(--color-primary-dark); }
.feature-title { font-size: var(--font-size-xl); font-weight: 600; margin-bottom: var(--space-2); }
.feature-desc { font-size: var(--font-size-base); color: var(--color-text-muted); line-height: 1.6; }
.features-integration { margin-top: var(--space-12); text-align: center; }
.integration-badge { display: inline-flex; align-items: center; gap: var(--space-3); padding: var(--space-4) var(--space-6); background: var(--color-bg); border-radius: var(--radius-full); font-size: var(--font-size-sm); color: var(--color-text-muted); }
.integration-badge svg { width: 20px; height: 20px; color: var(--color-primary); }
@media (min-width: 640px) { .features-grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1024px) { .features-grid { grid-template-columns: repeat(3, 1fr); } }

.how-it-works { padding: var(--space-20) 0; }
.steps { display: flex; flex-direction: column; gap: var(--space-6); max-width: var(--container-narrow); margin: 0 auto; }
.step { display: flex; align-items: flex-start; gap: var(--space-5); padding: var(--space-6); background: var(--color-white); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); }
.step-number { width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; background: var(--color-primary); color: var(--color-white); font-size: var(--font-size-xl); font-weight: 700; border-radius: 50%; flex-shrink: 0; }
.step-content h3 { font-size: var(--font-size-xl); font-weight: 600; margin-bottom: var(--space-2); }
.step-content p { color: var(--color-text-muted); }
.step-connector { display: none; }
@media (min-width: 768px) { .steps { flex-direction: row; align-items: flex-start; } .step { flex-direction: column; text-align: center; flex: 1; } .step-number { margin: 0 auto; } .step-connector { display: block; width: 60px; height: 2px; background: var(--color-border); margin-top: 24px; flex-shrink: 0; } }

.perspectives { padding: var(--space-20) 0; background: var(--color-white); }
.perspectives-grid { display: grid; gap: var(--space-8); }
.perspective-card { padding: var(--space-8); background: var(--color-bg); border-radius: var(--radius-xl); text-align: center; }
.perspective-icon { width: 64px; height: 64px; display: flex; align-items: center; justify-content: center; background: var(--color-primary-light); border-radius: 50%; margin: 0 auto var(--space-5); }
.perspective-icon svg { width: 28px; height: 28px; color: var(--color-primary-dark); }
.perspective-title { font-size: var(--font-size-2xl); font-weight: 700; margin-bottom: var(--space-4); }
.perspective-desc { font-size: var(--font-size-base); color: var(--color-text-muted); line-height: 1.7; margin-bottom: var(--space-6); }
.perspective-list { text-align: left; display: flex; flex-direction: column; gap: var(--space-3); }
.perspective-list li { display: flex; align-items: center; gap: var(--space-3); font-size: var(--font-size-sm); color: var(--color-text); }
.perspective-list li::before { content: ''; width: 20px; height: 20px; background: var(--color-primary); border-radius: 50%; flex-shrink: 0; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M20 6L9 17l-5-5'/%3E%3C/svg%3E"); background-size: 12px; background-repeat: no-repeat; background-position: center; }
@media (min-width: 768px) { .perspectives-grid { grid-template-columns: repeat(2, 1fr); } .perspective-card { text-align: left; } .perspective-icon { margin: 0 0 var(--space-5); } }

.social-proof { padding: var(--space-16) 0; }
.testimonial-card { max-width: var(--container-narrow); margin: 0 auto; padding: var(--space-10); background: var(--color-white); border-radius: var(--radius-xl); text-align: center; box-shadow: var(--shadow-md); }
.testimonial-card blockquote { font-size: var(--font-size-xl); font-weight: 500; line-height: 1.6; color: var(--color-text); margin-bottom: var(--space-6); }
.testimonial-author { display: flex; flex-direction: column; gap: var(--space-1); }
.author-name { font-weight: 600; color: var(--color-text); }
.author-title { font-size: var(--font-size-sm); color: var(--color-text-muted); }
@media (min-width: 768px) { .testimonial-card blockquote { font-size: var(--font-size-2xl); } }

.faq { padding: var(--space-20) 0; background: var(--color-white); }
.faq-list { max-width: var(--container-narrow); margin: 0 auto; display: flex; flex-direction: column; gap: var(--space-3); }
.faq-item { background: var(--color-bg); border-radius: var(--radius-md); overflow: hidden; }
.faq-item summary { padding: var(--space-5) var(--space-6); font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: space-between; list-style: none; }
.faq-item summary::-webkit-details-marker { display: none; }
.faq-item summary::after { content: '+'; font-size: var(--font-size-xl); color: var(--color-text-muted); transition: transform var(--transition-fast); }
.faq-item[open] summary::after { transform: rotate(45deg); }
.faq-item p { padding: 0 var(--space-6) var(--space-5); color: var(--color-text-muted); line-height: 1.7; }

.download-cta { padding: var(--space-20) 0; background: linear-gradient(180deg, var(--color-bg) 0%, var(--color-primary-light) 100%); }
.cta-content { text-align: center; max-width: var(--container-narrow); margin: 0 auto; }
.cta-content h2 { font-size: var(--font-size-3xl); font-weight: 700; margin-bottom: var(--space-4); }
.cta-content > p { font-size: var(--font-size-lg); color: var(--color-text-muted); margin-bottom: var(--space-8); }
.app-stores { display: flex; flex-direction: column; align-items: center; gap: var(--space-4); margin-bottom: var(--space-10); }
.store-badge { display: block; color: var(--color-text); transition: transform var(--transition-fast), opacity var(--transition-fast); }
.store-badge:hover { transform: scale(1.02); opacity: 0.9; }
.store-badge svg { height: 48px; width: auto; }
.cta-badges { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-6); }
@media (min-width: 640px) { .app-stores { flex-direction: row; justify-content: center; } .cta-content h2 { font-size: var(--font-size-4xl); } }

.footer { padding: var(--space-16) 0 var(--space-8); background: var(--color-text); color: var(--color-white); }
.footer-grid { display: grid; gap: var(--space-10); margin-bottom: var(--space-10); }
.footer-brand .logo { margin-bottom: var(--space-4); }
.footer-brand .logo-icon { color: var(--color-primary-light); }
.footer-tagline { color: rgba(255, 255, 255, 0.6); max-width: 280px; }
.footer-links { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-8); }
.footer-column h4 { font-size: var(--font-size-sm); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(255, 255, 255, 0.4); margin-bottom: var(--space-4); }
.footer-column a { display: block; padding: var(--space-2) 0; color: rgba(255, 255, 255, 0.8); font-size: var(--font-size-sm); transition: color var(--transition-fast); }
.footer-column a:hover { color: var(--color-white); }
.footer-bottom { padding-top: var(--space-8); border-top: 1px solid rgba(255, 255, 255, 0.1); text-align: center; }
.footer-bottom p { font-size: var(--font-size-sm); color: rgba(255, 255, 255, 0.4); }
@media (min-width: 768px) { .footer-grid { grid-template-columns: 2fr 1fr; align-items: start; } }

@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; } }
  </style>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to main content</a>

  <!-- Navigation -->
  <header class="header">
    <nav class="nav container">
      <a href="/" class="logo">
        <svg class="logo-icon" viewBox="0 0 100 120" fill="none" xmlns="http://www.w3.org/2000/svg">
          <ellipse cx="28" cy="70" rx="22" ry="28" stroke="currentColor" stroke-width="5" fill="none"/>
          <path d="M28 98 L25 103 L31 103 Z" stroke="currentColor" stroke-width="5" stroke-linejoin="round" fill="none"/>
          <path d="M28 103 Q26 115, 30 120" stroke="currentColor" stroke-width="5" stroke-linecap="round" fill="none"/>
          <ellipse cx="50" cy="45" rx="24" ry="32" stroke="currentColor" stroke-width="5" fill="none"/>
          <path d="M50 77 L47 82 L53 82 Z" stroke="currentColor" stroke-width="5" stroke-linejoin="round" fill="none"/>
          <path d="M50 82 Q48 100, 45 120" stroke="currentColor" stroke-width="5" stroke-linecap="round" fill="none"/>
          <ellipse cx="72" cy="58" rx="23" ry="30" stroke="currentColor" stroke-width="5" fill="none"/>
          <path d="M72 88 L69 93 L75 93 Z" stroke="currentColor" stroke-width="5" stroke-linejoin="round" fill="none"/>
          <path d="M72 93 Q75 108, 68 120" stroke="currentColor" stroke-width="5" stroke-linecap="round" fill="none"/>
        </svg>
        <span class="logo-text">Togather</span>
      </a>

      <div class="nav-links">
        <a href="#features">Features</a>
        <a href="#how-it-works">How it Works</a>
        <a href="#faq">FAQ</a>
      </div>

      <div class="nav-cta" style="display: flex; gap: 12px;">
        <a href="/signin" class="btn btn-secondary">Sign In</a>
        <a href="https://apps.apple.com/us/app/togather-life-in-community/id6756286011" class="btn btn-primary">Download iOS</a>
      </div>

      <button class="mobile-menu-btn" aria-label="Toggle menu" aria-expanded="false">
        <span></span>
        <span></span>
        <span></span>
      </button>
    </nav>

    <div class="mobile-menu">
      <a href="#features">Features</a>
      <a href="#how-it-works">How it Works</a>
      <a href="#faq">FAQ</a>
      <a href="/signin" class="btn btn-secondary">Sign In</a>
      <a href="https://apps.apple.com/us/app/togather-life-in-community/id6756286011" class="btn btn-primary">Download iOS</a>
    </div>
  </header>

  <main id="main-content">
    <!-- Hero Section -->
    <section class="hero">
      <div class="container">
        <div class="hero-content">
          <div class="hero-badge">
            <span class="badge-dot"></span>
            Mobile-first community app
          </div>

          <h1 class="hero-title">
            Your community,
            <span class="highlight">in your pocket.</span>
          </h1>

          <p class="hero-subtitle">
            Togather is a mobile-first app that brings your groups, messaging, and events
            into one place. Help members find their people and give leaders the tools
            to make sure no one slips through the cracks.
          </p>

          <div class="hero-cta">
            <a href="https://apps.apple.com/us/app/togather-life-in-community/id6756286011" class="btn btn-primary btn-lg">
              <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 5v14M5 12l7 7 7-7"/>
              </svg>
              Download for iOS
            </a>
            <a href="${landingUrl}/android" class="btn btn-secondary btn-lg">
              <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 5v14M5 12l7 7 7-7"/>
              </svg>
              Download for Android
            </a>
          </div>

          <div class="hero-badges">
            <div class="trust-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                <line x1="12" y1="18" x2="12" y2="18"/>
              </svg>
              <span>Mobile-first</span>
            </div>
            <div class="trust-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <path d="M9 12l2 2 4-4"/>
              </svg>
              <span>Free to use</span>
            </div>
            <div class="trust-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              <span>Built for churches</span>
            </div>
          </div>
        </div>

        <div class="hero-visual">
          <div class="phone-mockup">
            <div class="phone-screen">
              <div class="app-preview-map">
                <div class="map-bg">
                  <div class="map-road map-road-1"></div>
                  <div class="map-road map-road-2"></div>
                  <div class="map-road map-road-3"></div>
                </div>
                <div class="map-pin pin-1">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                    <circle cx="12" cy="10" r="3" fill="white"/>
                  </svg>
                </div>
                <div class="map-pin pin-2">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                    <circle cx="12" cy="10" r="3" fill="white"/>
                  </svg>
                </div>
                <div class="map-pin pin-3">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                    <circle cx="12" cy="10" r="3" fill="white"/>
                  </svg>
                </div>
                <div class="explore-card">
                  <div class="explore-card-header">
                    <span class="explore-title">Groups near you</span>
                    <span class="explore-count">12 groups</span>
                  </div>
                  <div class="explore-item">
                    <div class="explore-avatar"></div>
                    <div class="explore-info">
                      <div class="explore-name">Young Adults</div>
                      <div class="explore-meta">Wednesdays - 0.8 mi</div>
                    </div>
                  </div>
                  <div class="explore-item">
                    <div class="explore-avatar alt"></div>
                    <div class="explore-info">
                      <div class="explore-name">Family Group</div>
                      <div class="explore-meta">Sundays - 1.2 mi</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Features Section -->
    <section id="features" class="features">
      <div class="container">
        <div class="section-header">
          <h2 class="section-title">Everything your community needs</h2>
          <p class="section-subtitle">
            Stop juggling multiple apps. Togather brings groups, messaging, events, and
            leader tools into one seamless experience.
          </p>
        </div>

        <div class="features-grid">
          <div class="feature-card">
            <div class="feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <h3 class="feature-title">Group Management</h3>
            <p class="feature-desc">
              Create and manage any type of group-life groups, dinner parties, teams,
              or whatever fits your community. Members can discover and join groups near them.
            </p>
          </div>

          <div class="feature-card">
            <div class="feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <h3 class="feature-title">Real-Time Messaging</h3>
            <p class="feature-desc">
              Stay connected with group chat, announcements, and direct messages.
              No more lost texts or buried email threads-everyone stays in the loop.
            </p>
          </div>

          <div class="feature-card">
            <div class="feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <h3 class="feature-title">Event Scheduling</h3>
            <p class="feature-desc">
              Schedule meetings, track RSVPs, and share events with a simple link.
              Members get reminders and can RSVP with one tap.
            </p>
          </div>

          <div class="feature-card">
            <div class="feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
            </div>
            <h3 class="feature-title">Location Discovery</h3>
            <p class="feature-desc">
              Find groups near you with map-based discovery. Search by zip code
              or let the app find communities in your area.
            </p>
          </div>

          <div class="feature-card">
            <div class="feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <line x1="19" y1="8" x2="19" y2="14"/>
                <line x1="22" y1="11" x2="16" y2="11"/>
              </svg>
            </div>
            <h3 class="feature-title">Leader Tools</h3>
            <p class="feature-desc">
              Track attendance and spot who's been missing. Get insights on member
              engagement so no one slips through the cracks. Follow up with intention.
            </p>
          </div>

          <div class="feature-card">
            <div class="feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
            </div>
            <h3 class="feature-title">Smart Notifications</h3>
            <p class="feature-desc">
              Get timely reminders for upcoming meetings and new messages.
              Stay connected without being overwhelmed.
            </p>
          </div>
        </div>

        <div class="features-integration">
          <div class="integration-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="16 18 22 12 16 6"/>
              <polyline points="8 6 2 12 8 18"/>
            </svg>
            <span><strong>Planning Center integration</strong> available to sync your member data.</span>
          </div>
        </div>
      </div>
    </section>

    <!-- How it Works -->
    <section id="how-it-works" class="how-it-works">
      <div class="container">
        <div class="section-header">
          <h2 class="section-title">Get started in minutes</h2>
          <p class="section-subtitle">
            Setting up Togather is simple. Download, connect to your community, and start building relationships.
          </p>
        </div>

        <div class="steps">
          <div class="step">
            <div class="step-number">1</div>
            <div class="step-content">
              <h3>Download the app</h3>
              <p>Get Togather free on iOS or Android. No credit card required.</p>
            </div>
          </div>

          <div class="step-connector"></div>

          <div class="step">
            <div class="step-number">2</div>
            <div class="step-content">
              <h3>Join your community</h3>
              <p>Search for your church or organization and connect with your people.</p>
            </div>
          </div>

          <div class="step-connector"></div>

          <div class="step">
            <div class="step-number">3</div>
            <div class="step-content">
              <h3>Discover groups</h3>
              <p>Find groups that fit your interests and start building real connections.</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Two Perspectives Section -->
    <section class="perspectives">
      <div class="container">
        <div class="section-header">
          <h2 class="section-title">Built for everyone in your community</h2>
          <p class="section-subtitle">
            Whether you're leading a group or looking for one to join,
            Togather gives you what you need.
          </p>
        </div>

        <div class="perspectives-grid">
          <div class="perspective-card">
            <div class="perspective-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <h3 class="perspective-title">For Leaders</h3>
            <p class="perspective-desc">
              See at a glance who's showing up and who's been absent. Track attendance
              patterns, send timely follow-ups, and make data-driven decisions about
              your ministry. No more spreadsheets or guesswork.
            </p>
            <ul class="perspective-list">
              <li>Attendance tracking with visual trends</li>
              <li>Member engagement insights</li>
              <li>Easy RSVP and event management</li>
              <li>Leader-only chat channels</li>
            </ul>
          </div>

          <div class="perspective-card">
            <div class="perspective-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <h3 class="perspective-title">For Members</h3>
            <p class="perspective-desc">
              Find a group that fits your life-browse by location, see what's meeting
              near you, and join with a tap. Stay in the loop with group chat and
              never miss an event with smart reminders.
            </p>
            <ul class="perspective-list">
              <li>Discover groups on an interactive map</li>
              <li>One-tap RSVP for meetings</li>
              <li>Group messaging that actually works</li>
              <li>Calendar sync and reminders</li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <!-- Social Proof -->
    <section class="social-proof">
      <div class="container">
        <div class="testimonial-card">
          <blockquote>
            "Togather was created to help communities build stronger connections through technology.
            We believe every community deserves tools that foster genuine relationships."
          </blockquote>
          <div class="testimonial-author">
            <span class="author-name">The Togather Team</span>
            <span class="author-title">Our Mission</span>
          </div>
        </div>
      </div>
    </section>

    <!-- FAQ Section -->
    <section id="faq" class="faq">
      <div class="container">
        <div class="section-header">
          <h2 class="section-title">Frequently asked questions</h2>
          <p class="section-subtitle">
            Everything you need to know about getting started with Togather.
          </p>
        </div>

        <div class="faq-list">
          <details class="faq-item">
            <summary>Is Togather really free?</summary>
            <p>Yes! Togather is free to download and use. We offer premium features for larger organizations, but the core experience is completely free.</p>
          </details>

          <details class="faq-item">
            <summary>What platforms does Togather support?</summary>
            <p>Togather is available on iOS, Android, and the web. Your data syncs seamlessly across all devices.</p>
          </details>

          <details class="faq-item">
            <summary>Can I import members from Planning Center?</summary>
            <p>Yes! We have a Planning Center integration that lets you sync your member data during onboarding. This makes setup quick and easy.</p>
          </details>

          <details class="faq-item">
            <summary>How do members find and join groups?</summary>
            <p>Members can browse available groups, search by location with our map view, or use a direct invite link. Group leaders control whether their groups are public or private.</p>
          </details>

          <details class="faq-item">
            <summary>What kind of groups can I create?</summary>
            <p>Any kind! Life groups, dinner parties, teams, bible studies, volunteer groups-you name it. Your organization can customize group types to match your culture.</p>
          </details>

          <details class="faq-item">
            <summary>How does event scheduling work?</summary>
            <p>Group leaders can schedule one-time or recurring meetings. Members get reminders and can RSVP directly in the app. You can even share events with non-members via a public link.</p>
          </details>
        </div>
      </div>
    </section>

    <!-- Download CTA -->
    <section id="download" class="download-cta">
      <div class="container">
        <div class="cta-content">
          <h2>Ready to bring your community together?</h2>
          <p>Download Togather and start building real connections today.</p>

          <div class="app-stores">
            <a href="https://apps.apple.com/us/app/togather-life-in-community/id6756286011" class="store-badge" aria-label="Download on App Store">
              <svg viewBox="0 0 120 40" fill="currentColor">
                <rect width="120" height="40" rx="6"/>
                <text x="60" y="14" text-anchor="middle" fill="white" font-size="8" font-family="Inter, sans-serif">Download on the</text>
                <text x="60" y="28" text-anchor="middle" fill="white" font-size="14" font-weight="600" font-family="Inter, sans-serif">App Store</text>
              </svg>
            </a>
            <a href="${landingUrl}/android" class="store-badge" aria-label="Download for Android">
              <svg viewBox="0 0 135 40" fill="currentColor">
                <rect width="135" height="40" rx="6"/>
                <text x="67" y="14" text-anchor="middle" fill="white" font-size="8" font-family="Inter, sans-serif">Download for</text>
                <text x="67" y="28" text-anchor="middle" fill="white" font-size="14" font-weight="600" font-family="Inter, sans-serif">Android</text>
              </svg>
            </a>
          </div>

          <div class="cta-badges">
            <div class="trust-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <path d="M9 12l2 2 4-4"/>
              </svg>
              <span>Free to use</span>
            </div>
            <div class="trust-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                <line x1="8" y1="21" x2="16" y2="21"/>
                <line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
              <span>Works everywhere</span>
            </div>
            <div class="trust-badge">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              <span>Setup in minutes</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>

  <!-- Footer -->
  <footer class="footer">
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand">
          <a href="/" class="logo">
            <svg class="logo-icon" viewBox="0 0 100 120" fill="none" xmlns="http://www.w3.org/2000/svg">
              <ellipse cx="28" cy="70" rx="22" ry="28" stroke="currentColor" stroke-width="5" fill="none"/>
              <path d="M28 98 L25 103 L31 103 Z" stroke="currentColor" stroke-width="5" stroke-linejoin="round" fill="none"/>
              <path d="M28 103 Q26 115, 30 120" stroke="currentColor" stroke-width="5" stroke-linecap="round" fill="none"/>
              <ellipse cx="50" cy="45" rx="24" ry="32" stroke="currentColor" stroke-width="5" fill="none"/>
              <path d="M50 77 L47 82 L53 82 Z" stroke="currentColor" stroke-width="5" stroke-linejoin="round" fill="none"/>
              <path d="M50 82 Q48 100, 45 120" stroke="currentColor" stroke-width="5" stroke-linecap="round" fill="none"/>
              <ellipse cx="72" cy="58" rx="23" ry="30" stroke="currentColor" stroke-width="5" fill="none"/>
              <path d="M72 88 L69 93 L75 93 Z" stroke="currentColor" stroke-width="5" stroke-linejoin="round" fill="none"/>
              <path d="M72 93 Q75 108, 68 120" stroke="currentColor" stroke-width="5" stroke-linecap="round" fill="none"/>
            </svg>
            <span class="logo-text">Togather</span>
          </a>
          <p class="footer-tagline">Bringing communities together, one connection at a time.</p>
        </div>

        <div class="footer-links">
          <div class="footer-column">
            <h4>Product</h4>
            <a href="#features">Features</a>
            <a href="#how-it-works">How it Works</a>
            <a href="#download">Download</a>
          </div>

          <div class="footer-column">
            <h4>Legal</h4>
            <a href="/privacy">Privacy Policy</a>
            <a href="/terms">Terms of Service</a>
          </div>
        </div>
      </div>

      <div class="footer-bottom">
        <p>&copy; 2025 Togather. All rights reserved.</p>
      </div>
    </div>
  </footer>

  <script>
(function() {
  'use strict';
  const header = document.querySelector('.header');
  const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
  const mobileMenu = document.querySelector('.mobile-menu');
  const mobileMenuLinks = mobileMenu?.querySelectorAll('a');
  let isMenuOpen = false;

  function toggleMobileMenu() {
    isMenuOpen = !isMenuOpen;
    mobileMenuBtn?.setAttribute('aria-expanded', isMenuOpen.toString());
    mobileMenu?.classList.toggle('active', isMenuOpen);
    document.body.style.overflow = isMenuOpen ? 'hidden' : '';
  }

  function closeMobileMenu() {
    if (!isMenuOpen) return;
    isMenuOpen = false;
    mobileMenuBtn?.setAttribute('aria-expanded', 'false');
    mobileMenu?.classList.remove('active');
    document.body.style.overflow = '';
  }

  function handleScroll() {
    if (window.scrollY > 10) {
      header?.classList.add('scrolled');
    } else {
      header?.classList.remove('scrolled');
    }
  }

  function handleAnchorClick(e) {
    const href = e.currentTarget.getAttribute('href');
    if (href?.startsWith('#') && href.length > 1) {
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        closeMobileMenu();
        const headerHeight = header?.offsetHeight || 72;
        const targetPosition = target.getBoundingClientRect().top + window.scrollY - headerHeight;
        window.scrollTo({ top: targetPosition, behavior: 'smooth' });
        history.pushState(null, '', href);
      }
    }
  }

  function init() {
    mobileMenuBtn?.addEventListener('click', toggleMobileMenu);
    mobileMenuLinks?.forEach(link => link.addEventListener('click', closeMobileMenu));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMobileMenu(); });
    document.addEventListener('click', (e) => {
      if (isMenuOpen && !mobileMenu?.contains(e.target) && !mobileMenuBtn?.contains(e.target)) closeMobileMenu();
    });
    let scrollTimeout;
    window.addEventListener('scroll', () => {
      if (scrollTimeout) return;
      scrollTimeout = setTimeout(() => { handleScroll(); scrollTimeout = null; }, 10);
    }, { passive: true });
    document.querySelectorAll('a[href^="#"]').forEach(anchor => anchor.addEventListener('click', handleAnchorClick));
    handleScroll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
  </script>
</body>
</html>`;
}

export async function GET(_request: Request): Promise<Response> {
  // Always serve the static landing page HTML
  // Note: In production, subdomain routing is handled at the DNS/hosting level
  // Community subdomains (e.g., fount.togather.nyc) will be routed differently
  return new Response(generateLandingPageHtml(), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600", // Cache for 1 hour
    },
  });
}
