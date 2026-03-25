import { useState } from "react";
import { Link } from "react-router-dom";

// ============================================================================
// ICONS
// ============================================================================

function IconUsers({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconMessage({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconCalendar({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function IconMapPin({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function IconBell({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function IconChartBar({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  );
}

function IconCheck({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconPlus({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconShield({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function IconClock({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconMonitor({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function IconInbox({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

function IconAndroid({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85a.637.637 0 00-.83.22l-1.88 3.24a11.463 11.463 0 00-8.94 0L5.65 5.67a.643.643 0 00-.87-.2c-.28.18-.37.54-.22.83L6.4 9.48A10.78 10.78 0 001 18h22a10.78 10.78 0 00-5.4-8.52zM7 15.25a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm10 0a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z" />
    </svg>
  );
}

function IconGitHub({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

function IconMenu({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function IconX({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ============================================================================
// COMPONENTS
// ============================================================================

function HeroSection() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <section className="min-h-screen p-3 md:p-4">
      {/* Full-page Squircle Container */}
      <div className="relative min-h-[calc(100vh-1.5rem)] md:min-h-[calc(100vh-2rem)] rounded-[1.5rem] md:rounded-[1.75rem] flex flex-col overflow-hidden">
        {/* Base gradient - darker at top and bottom, creates contrast */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, #e5d2c0 0%, #f0e5db 25%, #f8f2ec 50%, #f0e5db 75%, #e5d2c0 100%)",
          }}
        />

        {/* Radial white glow in the center */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% 45%, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0) 70%)",
          }}
        />

        {/* Noise/grain overlay for texture */}
        <div
          className="absolute inset-0 opacity-[0.1] pointer-events-none mix-blend-overlay"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          }}
        />

        {/* Navigation - Inside the squircle */}
        <nav className="relative z-10 px-6 md:px-10 py-5">
          <div className="relative flex items-center justify-between max-w-[1400px] mx-auto">
            {/* Logo - black */}
            <a href="/" className="flex items-center gap-1 text-neutral-800">
              <img src="/images/togather-logo.png" alt="Togather logo" className="h-8 w-auto object-contain" />
              <span className="text-xl font-semibold text-neutral-800">
                Togather
              </span>
            </a>

            {/* Desktop Nav - Absolutely centered */}
            <div className="hidden md:flex items-center gap-8 absolute left-1/2 -translate-x-1/2">
              <a
                href="#features"
                className="text-sm font-medium text-neutral-700 hover:text-neutral-900"
              >
                Features
              </a>
              <a
                href="#faq"
                className="text-sm font-medium text-neutral-700 hover:text-neutral-900"
              >
                FAQ
              </a>
              <a
                href="https://github.com/togathernyc/togather"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-neutral-700 hover:text-neutral-900 inline-flex items-center gap-1.5"
              >
                <IconGitHub className="w-4 h-4" />
                GitHub
              </a>
            </div>

            {/* Desktop CTA */}
            <div className="hidden md:flex items-center gap-3">
              <a
                href="/onboarding/signin"
                className="px-5 py-2.5 text-sm font-medium text-neutral-700 hover:text-neutral-900"
              >
                Sign in
              </a>
              <a
                href="#download"
                className="px-5 py-2.5 text-sm font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded-xl"
              >
                Download
              </a>
            </div>

            {/* Mobile Menu Button */}
            <button
              className="md:hidden p-2 text-neutral-600"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <IconX /> : <IconMenu />}
            </button>
          </div>
        </nav>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="relative z-10 md:hidden bg-primary-100/90 backdrop-blur-sm mx-4 rounded-xl px-6 py-4 space-y-4 shadow-lg">
            <a
              href="#features"
              className="block text-neutral-600 hover:text-neutral-900 py-2"
            >
              Features
            </a>
            <a
              href="#faq"
              className="block text-neutral-600 hover:text-neutral-900 py-2"
            >
              FAQ
            </a>
            <a
              href="https://github.com/togathernyc/togather"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-neutral-600 hover:text-neutral-900 py-2"
            >
              <IconGitHub className="w-4 h-4" />
              GitHub
            </a>
            <div className="pt-2 space-y-2">
              <a
                href="/onboarding/signin"
                className="block text-center px-4 py-2.5 text-sm font-medium text-neutral-700 rounded-xl border border-neutral-200"
              >
                Sign in
              </a>
              <a
                href="#download"
                className="block text-center px-4 py-2.5 text-sm font-medium text-white bg-neutral-900 rounded-xl"
              >
                Download
              </a>
            </div>
          </div>
        )}

        {/* Hero Content - Side by side layout */}
        <div className="relative z-10 flex-1 flex items-center px-6 md:px-10 lg:px-16">
          <div className="w-full max-w-[1400px] mx-auto flex flex-col xl:flex-row items-center gap-6 xl:gap-12">
            {/* Left side - Text content */}
            <div className="flex-1 text-center xl:text-left pt-8 xl:pt-0">
              <h1 className="text-5xl md:text-6xl xl:text-7xl font-bold text-neutral-900 mb-5 leading-[1.1]">
                Your community,
                <br />
                in your pocket.
              </h1>

              <p className="text-base md:text-lg text-neutral-600 mb-8 max-w-xl mx-auto xl:mx-0 leading-relaxed">
                Togather is an open-source community platform that brings your
                groups, messaging, and events into one place. Built in the open,
                shaped by the communities that use it.
              </p>

              {/* Download Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 justify-center xl:justify-start items-center">
                <a href="https://apps.apple.com/us/app/togather-life-in-community/id6756286011">
                  <img
                    src="/images/app-store-badge.svg"
                    alt="Download on the App Store"
                    className="h-[52px]"
                  />
                </a>
                <Link
                  to="/android"
                  className="h-[52px] px-5 inline-flex items-center gap-2.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl transition-colors"
                >
                  <IconAndroid className="w-6 h-6" />
                  <div className="flex flex-col leading-tight">
                    <span className="text-[10px] font-medium text-white/70 uppercase tracking-wide">Download</span>
                    <span className="text-base font-semibold -mt-0.5">APK for Android</span>
                  </div>
                </Link>
              </div>
            </div>

            {/* Right side - Phone mockup */}
            <div className="flex justify-center xl:justify-end">
              <HeroPhoneMockup />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroPhoneMockup() {
  return (
    <div className="animate-bounce-subtle">
      <img
        src="/images/hero-phone-with-callouts.png"
        alt="Togather app showing map view with groups, events, and messaging"
        className="w-[510px] md:w-[600px] lg:w-[670px] max-w-full"
      />
    </div>
  );
}


function FeaturesSection() {
  const [activeTab, setActiveTab] = useState<
    "groups" | "messaging" | "events" | "admin"
  >("groups");

  const tabs = [
    { key: "groups" as const, label: "Groups" },
    { key: "messaging" as const, label: "Messaging" },
    { key: "events" as const, label: "Events" },
    { key: "admin" as const, label: "Admin Tools" },
  ];

  const tabContent = {
    groups: {
      headline:
        "Organize your community into groups that help people find their place and build real connections.",
      image: "/images/feature-groups.png",
      placeholder: "Groups preview coming soon",
      features: [
        {
          icon: <IconUsers className="w-5 h-5" />,
          title: "Group Types",
          description:
            "Create any type of group — life groups, teams, classes, or whatever fits your community's culture.",
        },
        {
          icon: <IconMapPin className="w-5 h-5" />,
          title: "Location Discovery",
          description:
            "Members can browse groups on a map and find what's meeting near them.",
        },
        {
          icon: <IconShield className="w-5 h-5" />,
          title: "Privacy Controls",
          description:
            "Leaders control whether groups are open, request-only, or invite-only.",
        },
      ],
    },
    messaging: {
      headline:
        "Keep conversations flowing with real-time messaging that keeps everyone connected and engaged.",
      image: "/images/feature-messaging.png",
      placeholder: "Messaging preview coming soon",
      features: [
        {
          icon: <IconMessage className="w-5 h-5" />,
          title: "Group Chat",
          description:
            "Built-in messaging for every group so members can stay in touch between meetups.",
        },
        {
          icon: <IconInbox className="w-5 h-5" />,
          title: "Unified Inbox",
          description:
            "All your conversations in one place — group chats, announcements, and community channels.",
        },
        {
          icon: <IconBell className="w-5 h-5" />,
          title: "Announcements",
          description:
            "Send important updates that cut through the noise and reach everyone.",
        },
      ],
    },
    events: {
      headline:
        "Schedule meetings, track RSVPs, and make it easy for members to show up and stay engaged.",
      image: "/images/feature-events.png",
      placeholder: "Events preview coming soon",
      features: [
        {
          icon: <IconCalendar className="w-5 h-5" />,
          title: "Event Scheduling",
          description:
            "Create one-time or recurring events with all the details members need in one place.",
        },
        {
          icon: <IconCheck className="w-5 h-5" />,
          title: "RSVP Tracking",
          description:
            "See who's coming at a glance so leaders can plan accordingly.",
        },
        {
          icon: <IconClock className="w-5 h-5" />,
          title: "Smart Reminders",
          description:
            "Automatic notifications so members never forget about an upcoming meeting.",
        },
      ],
    },
    admin: {
      headline:
        "Give leaders the visibility they need to care for their people and grow their groups with confidence.",
      image: "/images/feature-admin.png",
      placeholder: "Leader dashboard coming soon",
      features: [
        {
          icon: <IconChartBar className="w-5 h-5" />,
          title: "Attendance Tracking",
          description:
            "See who's showing up and spot members who've been absent so no one slips through the cracks.",
        },
        {
          icon: <IconUsers className="w-5 h-5" />,
          title: "Member Insights",
          description:
            "Understand engagement patterns and make data-driven decisions about your groups.",
        },
        {
          icon: <IconMonitor className="w-5 h-5" />,
          title: "Planning Center Sync",
          description:
            "Import and sync your member data seamlessly with our Planning Center integration.",
        },
      ],
    },
  };

  const content = tabContent[activeTab];

  return (
    <section id="features" className="pt-6 md:pt-10 pb-16 md:pb-20">
      <div className="max-w-7xl mx-auto px-6 md:px-10">
        {/* Section Header */}
        <div className="mb-10">
          <h2 className="text-4xl md:text-5xl font-bold text-neutral-900 mb-6">
            Everything your community needs
          </h2>
          <p className="text-lg text-neutral-600 max-w-2xl">
            Stop juggling multiple apps. Togather brings groups, messaging,
            events, and leader tools into one seamless experience — all
            open source, so you're never locked in.
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-10">
          <div className="inline-flex flex-wrap gap-3">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                onFocus={() => setActiveTab(tab.key)}
                className={`px-7 py-3 rounded-2xl text-lg transition-all cursor-pointer outline-none ${
                  activeTab === tab.key
                    ? "bg-white text-neutral-900 font-semibold shadow-sm border border-neutral-300"
                    : "text-neutral-400 font-medium hover:text-neutral-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content Grid */}
        <div className="flex flex-col lg:flex-row gap-6">
            {/* Left - Large Feature Card */}
            <div
              className="flex-1 rounded-3xl p-10 md:p-12 flex flex-col min-h-[540px]"
              style={{
                background:
                  "linear-gradient(180deg, #e5d2c0 0%, #f0e5db 40%, #f8f2ec 70%, #f0e5db 100%)",
              }}
            >
              <h3 className="text-2xl md:text-[1.75rem] font-medium text-neutral-800 leading-snug max-w-xl">
                {content.headline}
              </h3>
              <div className="mt-auto">
                {content.image ? (
                  <div className="mt-10 flex items-center justify-center">
                    <img
                      src={content.image}
                      alt={`${activeTab} feature`}
                      className="max-h-80 object-contain rounded-2xl shadow-lg"
                    />
                  </div>
                ) : (
                  <div className="h-56 bg-white/30 rounded-2xl flex items-center justify-center">
                    <div className="text-center">
                      <IconChartBar className="w-14 h-14 text-neutral-400 mx-auto mb-3" />
                      <p className="text-neutral-400 text-sm">
                        {content.placeholder}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right - Feature Cards */}
            <div className="lg:w-[420px] flex flex-col gap-5">
              {content.features.map((feature, index) => (
                <div
                  key={index}
                  className="flex-1 bg-neutral-50 rounded-2xl p-7 border border-neutral-200"
                >
                  <div className="flex items-center gap-3.5 mb-3">
                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-neutral-700 border border-neutral-200 flex-shrink-0">
                      {feature.icon}
                    </div>
                    <h4 className="text-lg font-bold text-neutral-900">
                      {feature.title}
                    </h4>
                  </div>
                  <p className="text-neutral-600 text-[0.95rem] leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

        {/* Integration Callout */}
        <div className="mt-16 flex justify-center">
          <div className="inline-flex items-center gap-3 px-5 py-3 bg-neutral-900 rounded-full">
            <img
              src="/images/planning-center-logo.png"
              alt="Planning Center"
              className="h-6 w-6 object-contain flex-shrink-0"
            />
            <span className="text-white/90 text-sm">
              <strong className="text-white font-semibold">
                Planning Center integration
              </strong>{" "}
              available to sync your member data.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function FAQSection() {
  const faqs = [
    {
      question: "What does it mean that Togather is open source?",
      answer:
        "It means the entire codebase is public on GitHub under the AGPL-3.0 license. For your church or organization, that means full transparency into how your data is handled, no vendor lock-in, and a product shaped by the community that uses it. You don't need to think about any of that to get started though — we offer shared hosting so you can sign up and go in minutes.",
    },
    {
      question: "What platforms does Togather support?",
      answer:
        "Togather is available on iOS (App Store), Android (APK download), and the web. Your data syncs seamlessly across all devices.",
    },
    {
      question: "Can I import members from Planning Center?",
      answer:
        "Yes! We have a Planning Center integration that lets you sync your member data during onboarding. This makes setup quick and easy.",
    },
    {
      question: "How do members find and join groups?",
      answer:
        "Members can browse available groups, search by location with our map view, or use a direct invite link. Group leaders control whether their groups are public or private.",
    },
    {
      question: "What kind of groups can I create?",
      answer:
        "Any kind! Life groups, dinner parties, teams, bible studies, volunteer groups - you name it. Your organization can customize group types to match your culture.",
    },
    {
      question: "How does event scheduling work?",
      answer:
        "Group leaders can schedule one-time or recurring meetings. Members get reminders and can RSVP directly in the app. You can even share events with non-members via a public link.",
    },
    {
      question: "Something is broken or I'd like something changed — what should I do?",
      answer:
        "We'd love to hear from you! Head over to our issue page to learn how to report a bug or request a feature. No technical skills needed — just a free GitHub account and a few minutes.",
      link: "/issue",
    },
  ];

  return (
    <section id="faq" className="py-12 md:py-10">
      <div className="max-w-3xl mx-auto px-6">
        {/* Section Header */}
        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-bold text-neutral-900 mb-4">
            Frequently asked questions
          </h2>
          <p className="text-lg text-neutral-600">
            Everything you need to know about getting started with Togather.
          </p>
        </div>

        {/* FAQ List */}
        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <FAQItem key={index} question={faq.question} answer={faq.answer} link={"link" in faq ? faq.link : undefined} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQItem({ question, answer, link }: { question: string; answer: string; link?: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-neutral-200">
      <button
        className="w-full px-6 py-4 flex items-center justify-between text-left cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="font-medium text-neutral-900">{question}</span>
        <span
          className={`text-neutral-400 transition-transform ${isOpen ? "rotate-45" : ""}`}
        >
          <IconPlus className="w-5 h-5" />
        </span>
      </button>
      {isOpen && (
        <div className="px-6 pb-4">
          <p className="text-neutral-600">{answer}</p>
          {link && (
            <Link to={link} className="inline-block mt-3 text-sm font-medium text-neutral-900 underline underline-offset-2 hover:text-neutral-700">
              Learn more &rarr;
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function CTASection() {
  return (
    <section id="download" className="pt-12 md:pt-24 pb-16 md:pb-32 px-3 md:px-4">
      <div className="max-w-5xl mx-auto">
        <div className="relative rounded-[2rem] overflow-hidden flex flex-col">
          {/* Background Image */}
          <img
            src="/images/cta-community.webp"
            alt=""
            className="absolute inset-0 w-full h-full object-cover blur-[2px] scale-[1.01]"
            style={{ objectPosition: "center 55%" }}
          />
          {/* Dark gradient overlay — stronger at top for text, fading toward bottom */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.45) 50%, rgba(0,0,0,0.75) 100%)",
            }}
          />

          {/* Spacer for image to show above content */}
          <div className="relative z-10 h-48 md:h-56" />

          {/* Content — pushed to bottom */}
          <div className="relative z-10 text-center px-6 pt-4 pb-12 md:pb-14">
            <h2 className="text-3xl md:text-[2.75rem] md:leading-tight font-bold text-white mb-3 tracking-tight max-w-xl mx-auto">
              Ready to bring your community together?
            </h2>
            <p className="text-base md:text-lg text-white/75 mb-6">
              Download Togather — free, open source, and built for communities like yours.
            </p>

            {/* Download Badges */}
            <div className="flex flex-row gap-3 justify-center items-center">
              <a href="https://apps.apple.com/us/app/togather-life-in-community/id6756286011">
                <img
                  src="/images/app-store-badge.svg"
                  alt="Download on the App Store"
                  className="h-[40px]"
                />
              </a>
              <Link
                to="/android"
                className="h-[40px] px-4 inline-flex items-center gap-2 bg-white/15 hover:bg-white/25 backdrop-blur-sm text-white rounded-xl border border-white/20 transition-colors"
              >
                <IconAndroid className="w-5 h-5" />
                <div className="flex flex-col leading-tight">
                  <span className="text-[9px] font-medium text-white/70 uppercase tracking-wide">Download</span>
                  <span className="text-sm font-semibold -mt-0.5">APK for Android</span>
                </div>
              </Link>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="sticky bottom-0 z-0 text-white overflow-hidden">
      {/* Top section — logo, links, copyright */}
      <div className="max-w-6xl mx-auto px-6 pt-16 pb-8">
        <div className="flex flex-col md:flex-row justify-between gap-12 mb-10">
          {/* Brand */}
          <div className="max-w-xs">
            <a href="/" className="flex items-center gap-1 text-white mb-3">
              <img src="/images/togather-logo.png" alt="Togather logo" className="h-8 w-auto object-contain brightness-0 invert" />
              <span className="text-xl font-semibold">Togather</span>
            </a>
            <p className="text-sm text-neutral-400">
              Open-source community platform.<br />Built in the open, shaped by you.
            </p>
          </div>

          {/* Links */}
          <div className="flex gap-12 md:gap-16">
            <div>
              <h4 className="font-semibold mb-4 text-neutral-300 text-sm uppercase tracking-wider">Product</h4>
              <ul className="space-y-3 text-neutral-400 text-sm">
                <li>
                  <a href="#features" className="hover:text-white">
                    Features
                  </a>
                </li>
                <li>
                  <a href="#faq" className="hover:text-white">
                    FAQ
                  </a>
                </li>
                <li>
                  <a href="#download" className="hover:text-white">
                    Download
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4 text-neutral-300 text-sm uppercase tracking-wider">Open Source</h4>
              <ul className="space-y-3 text-neutral-400 text-sm">
                <li>
                  <a href="https://github.com/togathernyc/togather" target="_blank" rel="noopener noreferrer" className="hover:text-white inline-flex items-center gap-1.5">
                    <IconGitHub className="w-3.5 h-3.5" />
                    GitHub
                  </a>
                </li>
                <li>
                  <Link to="/contribute" className="hover:text-white">
                    Contribute
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4 text-neutral-300 text-sm uppercase tracking-wider">Legal</h4>
              <ul className="space-y-3 text-neutral-400 text-sm">
                <li>
                  <Link to="/legal/privacy" className="hover:text-white">
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link to="/legal/terms" className="hover:text-white">
                    Terms of Service
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Copyright */}
        <div className="text-neutral-600 text-xs">
          <p>&copy; {new Date().getFullYear()} Togather. All rights reserved.</p>
        </div>
      </div>

      {/* Giant wordmark — cropped at bottom */}
      <div className="relative max-w-6xl mx-auto px-6 -mb-[0.15em]">
        <p className="text-[8rem] md:text-[12rem] lg:text-[16rem] font-bold leading-none text-neutral-800 select-none overflow-hidden max-h-[0.95em]">
          Togather
        </p>
      </div>
    </footer>
  );
}

// ============================================================================
// MAIN APP
// ============================================================================

export default function App() {
  return (
    <div className="bg-neutral-900">
      <main className="relative z-10 bg-white rounded-b-[2.5rem] md:rounded-b-[3rem] pb-8">
        <HeroSection />
        <FeaturesSection />
        <FAQSection />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}
