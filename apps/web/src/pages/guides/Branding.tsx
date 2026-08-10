import { useMemo, useState } from "react";
import { GuideLayout, type TocItem } from "../../components/guide/GuideLayout";
import {
  Lead,
  Section,
  P,
  Callout,
  Term,
  DeepLink,
  Figure,
} from "../../components/guide/primitives";
import { PhoneFrame } from "../../components/guide/PhoneFrame";
import { appLinks } from "../../guides/appLinks";

/**
 * Guide: "Set up your name, logo & brand colors".
 *
 * Walks a non-technical church admin through the community appearance/branding
 * settings. Field labels here mirror the real admin screen
 * (apps/mobile/features/admin/components/SettingsContent.tsx) and the
 * `updateCommunitySettings` mutation (apps/convex/functions/admin/settings.ts):
 * Community Name, Logo, Subdomain, Primary Color, Secondary Color.
 *
 * The "Subdomain" field is labeled that way in the app, but it really sets the
 * community's path-based link (togather.nyc/your-church) that leads to the
 * public landing page. We're honest about the label while explaining what it
 * does.
 */

const toc: TocItem[] = [
  { id: "where", label: "Where to find branding" },
  { id: "name", label: "Name & your link" },
  { id: "logo", label: "Logo" },
  { id: "color", label: "Brand color" },
];

export function Branding() {
  return (
    <GuideLayout slug="branding" toc={toc}>
      <Lead>
        A few minutes in your settings is all it takes to make Togather feel like
        home for your congregation. Set your community's name, give out a link
        people can remember, add your logo, and pick a brand color — so the
        moment someone opens the app, they know they're in the right place.
      </Lead>

      <Section id="where" title="Where to find branding">
        <P>
          Branding lives in your admin settings. Open <Term>Admin</Term>, then
          tap the <Term>Settings</Term> tab. Everything that controls how your
          community looks — name, logo, link, and{" "}
          <Term>Branding Colors</Term> — lives in the cards on that screen.
        </P>
        <P>
          Ready to set this up? This opens your own live community, signed in as
          you.
        </P>
        <P>
          <DeepLink href={appLinks.branding}>
            Open your branding settings
          </DeepLink>
        </P>
        <Figure caption="Admin → Settings. The Basic Information card holds your name, logo, and link.">
          <BasicInfoMock />
        </Figure>
      </Section>

      <Section id="name" title="Name & your link">
        <P>
          The <Term>Basic Information</Term> card sets your community's identity.{" "}
          <Term>Community Name</Term> is the friendly display name members see
          throughout the app — for example, "Grace Community Church." Set it to
          whatever your congregation calls you.
        </P>
        <P>
          The field labeled <Term>Subdomain</Term> is more important than its
          name suggests. Whatever you type here becomes your community's link:{" "}
          <Term>togather.nyc/your-church</Term>. That link is the front door —
          it opens your <strong>landing page</strong>, the first thing a
          newcomer sees.
        </P>
        <P>
          Your landing page is a simple welcome form. A visitor enters their
          first name, last name, and phone number (you can also turn on email
          and add your own custom fields), and each person who fills it out
          becomes a row in your community's <Term>People</Term>. It's the
          easiest way to capture someone the moment they're interested, before
          they've even downloaded anything.
        </P>
        <Callout tone="warn" title="Your link has to be one-of-a-kind">
          <P>
            Every community needs its own link, so yours must be unique. A
            handful of names are also reserved because the app already uses them
            as web addresses — words like <Term>admin</Term>, <Term>chat</Term>,{" "}
            <Term>groups</Term>, <Term>search</Term>, and <Term>signup</Term>{" "}
            can't be used. If a name is taken or reserved, just try a small
            variation. Lowercase letters, numbers, and hyphens only.
          </P>
        </Callout>
        <Callout tone="tip" title="Customize the landing page">
          <P>
            Want to change the welcome message, the form fields, or the look of
            your landing page? In <Term>Admin Settings</Term>, open{" "}
            <Term>Quick Links</Term> and choose <Term>Landing Page</Term>.
          </P>
        </Callout>
        <Figure caption="The Subdomain field becomes your link, togather.nyc/your-church — the door to your landing page.">
          <NameLinkMock />
        </Figure>
      </Section>

      <Section id="logo" title="Logo">
        <P>
          Your <Term>Logo</Term> appears in headers across the app, so it's the
          first visual cue members recognize. Tap <Term>Select Logo</Term> and
          pick an image from your device.
        </P>
        <P>
          Two quick tips: a <strong>square</strong> image works best so nothing
          gets cropped, and a logo with a <strong>transparent background</strong>{" "}
          sits cleanly on both light and dark screens.
        </P>
      </Section>

      <Section id="color" title="Brand color">
        <P>
          The <Term>Branding Colors</Term> card has pickers for a primary and a
          secondary color, but in practice only one matters: your{" "}
          <strong>primary color</strong>. It's the accent the live app actually
          uses — for buttons, active tabs, links, and highlights. Don't worry
          about the secondary color; you can leave it as-is.
        </P>
        <P>
          The one thing to get right: pick a color that looks good in{" "}
          <strong>both light mode and dark mode</strong>. Togather renders both,
          and members choose whichever they prefer, so your color needs to read
          well on a white screen and a near-black one. Very pale colors wash out
          on white; very dark colors disappear on black. Aim for the middle.
        </P>
        <P>
          Try it below — pick a color and see exactly where it shows up, side by
          side in both modes.
        </P>

        <ColorPreviewWidget />

        <P>
          When you make a change, a <Term>Save Changes</Term> bar slides up
          pinned to the bottom of the screen. Tap it and your branding applies
          to your whole community immediately.
        </P>
        <Figure caption="The Branding Colors card — focus on Primary Color. Save Changes applies it everywhere.">
          <BrandingColorsMock />
        </Figure>
      </Section>
    </GuideLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Page-local UI mockups — reconstructions of the in-app screens.      */
/* Match apps/mobile/features/admin/components/SettingsContent.tsx.     */
/* ------------------------------------------------------------------ */

/** App default green — matches the in-app primary color default. */
const APP_DEFAULT_PRIMARY = "#1E8449";

/** Real theme tokens from the app, used by the color preview widget. */
const LIGHT_THEME = {
  surface: "#ffffff",
  secondarySurface: "#f5f5f5",
  text: "#1a1a1a",
  secondaryText: "#666666",
} as const;

const DARK_THEME = {
  background: "#0b141a",
  surface: "#1f2c34",
  secondarySurface: "#1a2730",
  text: "#e9edef",
  secondaryText: "#8696a0",
} as const;

/**
 * The iOS-style segmented control header at the top of the Admin screen.
 * Active segment is a white pill with a subtle shadow.
 */
function AdminHeaderMock() {
  const tabs = ["Requests", "People", "Stats", "Notify", "Settings"];
  const active = "Settings";
  return (
    <div className="bg-[#f5f5f5] px-4 pt-3 pb-2">
      <p className="text-xl font-bold text-[#1a1a1a] mb-3">Admin</p>
      <div className="flex rounded-lg bg-neutral-200/80 p-0.5">
        {tabs.map((t) => (
          <span
            key={t}
            className={`flex-1 text-center text-[10px] font-medium rounded-md py-1 ${
              t === active
                ? "bg-white text-[#1a1a1a] shadow-sm"
                : "text-neutral-500"
            }`}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A settings card: white, radius 12, padding 16, 18px/600 title. */
function SettingsCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-white p-4">
      <p className="text-[18px] font-semibold text-[#1a1a1a] mb-3">{title}</p>
      <div className="space-y-3.5">{children}</div>
    </div>
  );
}

/** 14px/500 gray label above an input. */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[14px] font-medium text-[#666666]">
      {children}
    </label>
  );
}

/** Rounded-8, 1px #ecedf0 border, white bg text input mock. */
function TextField({
  label,
  value,
  placeholder,
  helper,
}: {
  label: string;
  value?: string;
  placeholder?: string;
  helper?: string;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="rounded-lg border border-[#ecedf0] bg-white px-3 py-2.5 text-sm">
        {value ? (
          <span className="text-[#1a1a1a]">{value}</span>
        ) : (
          <span className="text-neutral-400">{placeholder}</span>
        )}
      </div>
      {helper && <p className="mt-1.5 text-[11px] text-[#666666]">{helper}</p>}
    </div>
  );
}

/** The Logo field empty state: dashed button, image icon, primary-tinted text. */
function LogoField() {
  return (
    <div>
      <FieldLabel>Logo</FieldLabel>
      <div
        className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed py-4"
        style={{ borderColor: APP_DEFAULT_PRIMARY }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke={APP_DEFAULT_PRIMARY}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <span
          className="text-sm font-medium"
          style={{ color: APP_DEFAULT_PRIMARY }}
        >
          Select Logo
        </span>
      </div>
    </div>
  );
}

/** The Basic Information card mock (name + logo + subdomain). */
function BasicInfoMock() {
  return (
    <PhoneFrame title="Settings">
      <div className="min-h-full bg-[#f5f5f5]">
        <AdminHeaderMock />
        <div className="p-4">
          <SettingsCard title="Basic Information">
            <TextField
              label="Community Name"
              placeholder="Enter community name"
            />
            <LogoField />
            <TextField
              label="Subdomain"
              placeholder="your-community"
              helper="Lowercase letters, numbers, and hyphens only"
            />
          </SettingsCard>
        </div>
      </div>
    </PhoneFrame>
  );
}

/** Focused on the Subdomain field with a filled value to show the link. */
function NameLinkMock() {
  return (
    <PhoneFrame title="Settings">
      <div className="min-h-full bg-[#f5f5f5]">
        <AdminHeaderMock />
        <div className="p-4 space-y-3">
          <SettingsCard title="Basic Information">
            <TextField
              label="Community Name"
              value="Grace Community Church"
            />
            <TextField
              label="Subdomain"
              value="grace-community"
              helper="Lowercase letters, numbers, and hyphens only"
            />
          </SettingsCard>
          <div className="rounded-xl border border-[#ecedf0] bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#666666] mb-1">
              Your link
            </p>
            <p className="text-sm font-medium text-[#1a1a1a]">
              togather.nyc/<span style={{ color: APP_DEFAULT_PRIMARY }}>grace-community</span>
            </p>
            <p className="mt-1 text-[11px] text-[#666666]">
              Opens your landing page — the welcome form newcomers fill out.
            </p>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

/** A color row: bordered, 32×32 rounded-6 swatch, monospace hex, chevron. */
function ColorRow({ label, hex }: { label: string; hex: string }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-2.5 rounded-lg border border-[#ecedf0] bg-white px-3 py-2.5">
        <span
          className="h-8 w-8 flex-shrink-0 rounded-md"
          style={{ backgroundColor: hex }}
        />
        <span className="flex-1 text-sm font-mono text-[#1a1a1a]">{hex}</span>
        <span className="text-neutral-300">›</span>
      </div>
    </div>
  );
}

/** The Branding Colors card mock with a pinned Save Changes bar. */
function BrandingColorsMock() {
  return (
    <PhoneFrame title="Settings">
      <div className="relative flex min-h-full flex-col bg-[#f5f5f5]">
        <AdminHeaderMock />
        <div className="flex-1 p-4">
          <SettingsCard title="Branding Colors">
            <p className="text-[12px] leading-snug text-[#666666]">
              Customize your community's accent colors. These colors will be used
              for buttons, links, and other interactive elements.
            </p>
            <ColorRow label="Primary Color" hex={APP_DEFAULT_PRIMARY} />
            <ColorRow label="Secondary Color" hex="#34495E" />
            <div className="rounded-lg border border-[#ecedf0] bg-white p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#666666] mb-2">
                Preview
              </p>
              <button
                className="w-full rounded-lg py-2 text-xs font-semibold text-white"
                style={{ backgroundColor: APP_DEFAULT_PRIMARY }}
              >
                Example button
              </button>
            </div>
          </SettingsCard>
        </div>
        {/* Pinned Save Changes bar */}
        <div className="border-t border-[#ecedf0] bg-white p-3">
          <button
            className="w-full rounded-lg py-2.5 text-sm font-semibold text-white"
            style={{ backgroundColor: APP_DEFAULT_PRIMARY }}
          >
            Save Changes
          </button>
        </div>
      </div>
    </PhoneFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Interactive color preview widget.                                   */
/* Shows where the primary color appears in both light and dark mode.  */
/* ------------------------------------------------------------------ */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Mix a hex color with a base color at the given alpha (0–1). */
function tint(hex: string, baseHex: string, alpha: number): string {
  const c = parseHex(hex);
  const b = parseHex(baseHex);
  if (!c || !b) return hex;
  const mix = (x: number, y: number) => Math.round(x * alpha + y * (1 - alpha));
  return `rgb(${mix(c.r, b.r)}, ${mix(c.g, b.g)}, ${mix(c.b, b.b)})`;
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  if (!HEX_RE.test(hex)) return null;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/** One mini phone-surface preview (light or dark) using real theme tokens. */
function ModePreview({
  mode,
  color,
}: {
  mode: "light" | "dark";
  color: string;
}) {
  const isDark = mode === "dark";
  const bg = isDark ? DARK_THEME.background : LIGHT_THEME.surface;
  const surface = isDark ? DARK_THEME.surface : LIGHT_THEME.secondarySurface;
  const text = isDark ? DARK_THEME.text : LIGHT_THEME.text;
  const subText = isDark ? DARK_THEME.secondaryText : LIGHT_THEME.secondaryText;
  // Accent chip: color at ~10% over the surface, color as foreground.
  const chipBg = tint(color, surface, 0.12);

  return (
    <div className="flex-1">
      <p className="mb-1.5 text-center text-[11px] font-medium text-neutral-500">
        {isDark ? "Dark mode" : "Light mode"}
      </p>
      <div
        className="overflow-hidden rounded-xl border"
        style={{
          backgroundColor: bg,
          borderColor: isDark ? "#0b141a" : "#e5e5e5",
        }}
      >
        <div className="p-3 space-y-3">
          {/* Accent chip */}
          <div
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{ backgroundColor: chipBg, color }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            New
          </div>

          {/* A small card */}
          <div className="rounded-lg p-2.5" style={{ backgroundColor: surface }}>
            <p className="text-[12px] font-semibold" style={{ color: text }}>
              Young Adults
            </p>
            <p className="text-[10px]" style={{ color: subText }}>
              Wednesdays · 7:00 PM
            </p>
          </div>

          {/* Filled primary button */}
          <button
            className="w-full rounded-lg py-2 text-[12px] font-semibold text-white"
            style={{ backgroundColor: color }}
          >
            Save Changes
          </button>
        </div>

        {/* Tab bar with an active (tinted) tab */}
        <div
          className="flex items-center justify-around border-t px-2 py-2"
          style={{
            backgroundColor: surface,
            borderColor: isDark
              ? DARK_THEME.secondarySurface
              : LIGHT_THEME.surface,
          }}
        >
          <TabItem label="Home" color={color} active />
          <TabItem label="Groups" color={subText} />
          <TabItem label="Chat" color={subText} />
        </div>
      </div>
    </div>
  );
}

/** A single tab-bar item (icon dot + label) tinted with the given color. */
function TabItem({
  label,
  color,
  active = false,
}: {
  label: string;
  color: string;
  active?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span
        className="h-3.5 w-3.5 rounded-md"
        style={{ backgroundColor: color, opacity: active ? 1 : 0.7 }}
      />
      <span
        className="text-[8px]"
        style={{ color, fontWeight: active ? 600 : 400 }}
      >
        {label}
      </span>
    </div>
  );
}

const EXAMPLE_SWATCHES = [
  { hex: "#1E8449", name: "Green" },
  { hex: "#2563EB", name: "Blue" },
  { hex: "#9333EA", name: "Purple" },
  { hex: "#D97706", name: "Amber" },
];

/** Interactive widget: pick a color, preview it live in light + dark mode. */
function ColorPreviewWidget() {
  const [color, setColor] = useState(APP_DEFAULT_PRIMARY);
  const [hexInput, setHexInput] = useState(APP_DEFAULT_PRIMARY);

  // Validity tracks what's typed, not the last-applied color, so invalid
  // entries surface the warning instead of silently keeping the old preview.
  const valid = useMemo(() => {
    const normalized = hexInput.startsWith("#") ? hexInput : `#${hexInput}`;
    return HEX_RE.test(normalized);
  }, [hexInput]);

  function applyHex(next: string) {
    setHexInput(next);
    const normalized = next.startsWith("#") ? next : `#${next}`;
    if (HEX_RE.test(normalized)) setColor(normalized);
  }

  function pickColor(next: string) {
    setColor(next);
    setHexInput(next);
  }

  return (
    <div className="my-8 rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
      {/* Picker row */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="text-sm font-medium text-neutral-700">
            Your color
          </span>
          <input
            type="color"
            value={color}
            onChange={(e) => pickColor(e.target.value)}
            className="h-9 w-9 cursor-pointer rounded-lg border border-neutral-200 bg-white p-0.5"
            aria-label="Pick brand color"
          />
        </label>
        <input
          type="text"
          value={hexInput}
          onChange={(e) => applyHex(e.target.value.trim())}
          spellCheck={false}
          className="w-28 rounded-lg border border-neutral-200 bg-white px-3 py-2 font-mono text-sm text-neutral-800 focus:border-primary-400 focus:outline-none"
          aria-label="Hex color value"
        />
        {!valid && (
          <span className="text-xs text-amber-600">
            Enter a 6-digit hex, e.g. #1E8449
          </span>
        )}
      </div>

      {/* Example swatches */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-neutral-500">Looks good in both:</span>
        {EXAMPLE_SWATCHES.map((s) => (
          <button
            key={s.hex}
            type="button"
            onClick={() => pickColor(s.hex)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
              color.toLowerCase() === s.hex.toLowerCase()
                ? "border-neutral-400 bg-neutral-50"
                : "border-neutral-200 hover:bg-neutral-50"
            }`}
          >
            <span
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: s.hex }}
            />
            {s.name}
          </button>
        ))}
      </div>

      {/* Side-by-side previews */}
      <div className="mt-5 flex gap-4">
        <ModePreview mode="light" color={valid ? color : APP_DEFAULT_PRIMARY} />
        <ModePreview mode="dark" color={valid ? color : APP_DEFAULT_PRIMARY} />
      </div>
      <p className="mt-3 text-center text-xs text-neutral-500">
        Your primary color appears on the active tab, filled buttons, and accent
        chips — in both modes.
      </p>
    </div>
  );
}
