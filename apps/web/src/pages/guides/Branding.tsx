import { GuideLayout, type TocItem } from "../../components/guide/GuideLayout";
import {
  Lead,
  Section,
  P,
  Callout,
  Steps,
  Step,
  Term,
  DeepLink,
  Figure,
} from "../../components/guide/primitives";
import { PhoneFrame, Avatar } from "../../components/guide/PhoneFrame";
import { appLinks } from "../../guides/appLinks";

/**
 * Guide: "Set up your name, logo & brand colors".
 *
 * Walks a non-technical church admin through the community appearance/branding
 * settings. Field labels here mirror the real admin screen
 * (apps/mobile/features/admin/components/SettingsContent.tsx) and the
 * `updateCommunitySettings` mutation (apps/convex/functions/admin/settings.ts):
 * Community Name, Logo, Subdomain, Primary Color, Secondary Color.
 */

const toc: TocItem[] = [
  { id: "where", label: "Where to find branding" },
  { id: "name", label: "Name & subdomain" },
  { id: "logo", label: "Logo & app icon" },
  { id: "colors", label: "Brand colors" },
  { id: "preview", label: "Preview & save" },
];

export function Branding() {
  return (
    <GuideLayout slug="branding" toc={toc}>
      <Lead>
        A few minutes in your settings is all it takes to make Togather feel like
        home for your congregation. Add your church's name, drop in your logo,
        and pick your colors — so the moment someone opens the app, they know
        they're in the right place.
      </Lead>

      <Section id="where" title="Where to find branding">
        <P>
          Branding lives in your admin settings. Open the{" "}
          <Term>Settings</Term> area for your community and look for the section
          that controls how the app looks — your name, logo, and{" "}
          <Term>Branding Colors</Term> all live together here.
        </P>
        <P>
          <DeepLink href={appLinks.branding}>Open branding settings</DeepLink>
        </P>
        <Figure caption="The admin settings menu — branding and appearance are grouped together.">
          {/* swap-in: <img src="/images/guides/branding-settings.png" /> */}
          <SettingsMenuMock />
        </Figure>
      </Section>

      <Section id="name" title="Name & subdomain">
        <P>
          Two fields set your church's identity. <Term>Community Name</Term> is
          the friendly display name your members see throughout the app — for
          example, "Grace Community Church." Set it to whatever your congregation
          calls you.
        </P>
        <P>
          <Term>Subdomain</Term> is your short, unique web address — the handle
          in your community's link (think <Term>your-church</Term> in{" "}
          <Term>your-church.togather.nyc</Term>). Keep it short, lowercase, and
          easy to share on a bulletin or text message.
        </P>
        <Callout tone="warn" title="Subdomains are one-of-a-kind">
          <P>
            Every church needs its own subdomain, so yours has to be unique. If
            you see a message that it's already in use, try a small variation
            until it's available.
          </P>
        </Callout>
        <Figure caption="Your display name and subdomain — the two fields that name your church.">
          {/* swap-in: <img src="/images/guides/branding-name.png" /> */}
          <NameFieldsMock />
        </Figure>
      </Section>

      <Section id="logo" title="Logo & app icon">
        <P>
          Your <Term>Logo</Term> appears in headers across the app, so it's the
          first visual cue members recognize. You can also set an app icon — the
          little rounded square members tap to open Togather on their phone. A
          few simple choices make both look sharp.
        </P>
        <Steps>
          <Step n={1}>
            In the branding settings, tap <Term>Select Logo</Term> and choose an
            image from your device.
          </Step>
          <Step n={2}>
            Use a <strong>square</strong> image so nothing gets cropped or
            stretched.
          </Step>
          <Step n={3}>
            Prefer a <strong>transparent PNG</strong> so your logo sits cleanly
            on any background, light or dark.
          </Step>
          <Step n={4}>
            Keep it <strong>simple and readable when small</strong> — fine print
            and thin lines disappear at icon size. A clean mark or your initials
            works best.
          </Step>
        </Steps>
        <Callout tone="tip">
          <P>
            If you only have one image, your full logo can double as both the
            header logo and the app icon — just make sure it still reads clearly
            shrunk down to a thumbnail.
          </P>
        </Callout>
      </Section>

      <Section id="colors" title="Brand colors">
        <P>
          Colors are what make the app feel like yours. You'll set two:{" "}
          <Term>Primary Color</Term> and <Term>Secondary Color</Term>. As the
          app describes it, these are your community's accent colors, used for
          buttons, links, and other interactive elements.
        </P>
        <P>
          <strong>Primary</strong> is your main accent — it shows up on buttons
          and highlights all over the app, so pick the color your church is most
          known for. <strong>Secondary</strong> is a supporting color that pairs
          with it for accents and details.
        </P>
        <P>
          Each color is entered as a <Term>hex</Term> value (a code like{" "}
          <Term>#6B4423</Term>). If you have a brand kit, use the exact codes
          from there; otherwise the color picker lets you choose visually.
        </P>
        <Callout tone="tip" title="Choose colors people can read">
          <P>
            Your primary color often sits behind white text on buttons, so go
            for a deeper, richer shade rather than a pale one — light colors make
            white text hard to read. When in doubt, pick a color with enough
            contrast that text stays crisp and legible for everyone.
          </P>
        </Callout>
        <Figure caption="Set your primary and secondary colors and see them update live.">
          {/* swap-in: <img src="/images/guides/branding-colors.png" /> */}
          <ColorFormMock />
        </Figure>
      </Section>

      <Section id="preview" title="Preview & save">
        <P>
          Before you finish, take a quick look at the live preview to see how
          your name, logo, and colors come together. Adjust anything that feels
          off, then save — your changes apply across your whole community at
          once.
        </P>
        <Callout tone="note">
          <P>
            Saving updates the app for everyone in your church, so what you see
            in the preview is what your members will see. You can come back and
            tweak your branding any time as your church grows or refreshes its
            look.
          </P>
        </Callout>
        <Figure caption="A live preview of your branding before you save.">
          {/* swap-in: <img src="/images/guides/branding-preview.png" /> */}
          <PreviewMock />
        </Figure>
      </Section>
    </GuideLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Page-local UI mockups — reconstructions of the in-app screens.      */
/* These are swapped for real screenshots via <Figure src=...>.        */
/* ------------------------------------------------------------------ */

/** Settings menu with the Branding / Appearance row highlighted. */
function SettingsMenuMock() {
  const rows = [
    { icon: "🎨", label: "Branding & Appearance", active: true },
    { icon: "📍", label: "Address & location" },
    { icon: "🔭", label: "Explore page settings" },
    { icon: "🧩", label: "Group types" },
  ];
  return (
    <PhoneFrame title="Settings">
      <div className="p-4 space-y-2.5 bg-neutral-50">
        {rows.map((row) => (
          <div
            key={row.label}
            className={`flex items-center gap-3 rounded-xl border p-3 ${
              row.active
                ? "border-primary-300 bg-primary-50 ring-2 ring-primary-200"
                : "border-neutral-200 bg-white"
            }`}
          >
            <span className="text-lg" aria-hidden>
              {row.icon}
            </span>
            <span
              className={`text-sm font-medium ${
                row.active ? "text-primary-800" : "text-neutral-700"
              }`}
            >
              {row.label}
            </span>
            <span className="ml-auto text-neutral-300">›</span>
          </div>
        ))}
      </div>
    </PhoneFrame>
  );
}

/** Name + subdomain text fields. */
function NameFieldsMock() {
  return (
    <PhoneFrame title="Branding">
      <div className="p-4 space-y-4 bg-neutral-50">
        <Field label="Community Name" value="Grace Community Church" />
        <div>
          <FieldLabel>Subdomain</FieldLabel>
          <div className="flex items-stretch rounded-xl border border-neutral-200 bg-white overflow-hidden">
            <span className="px-3 py-2.5 text-sm text-neutral-800 font-medium">
              grace-community
            </span>
            <span className="ml-auto flex items-center px-3 bg-neutral-100 text-xs text-neutral-400 border-l border-neutral-200">
              .togather.nyc
            </span>
          </div>
          <p className="mt-1.5 text-[11px] text-neutral-400">
            Must be unique. Lowercase letters, numbers and hyphens.
          </p>
        </div>
      </div>
    </PhoneFrame>
  );
}

/** Brand color form with two swatches, hex inputs, and a live preview chip. */
function ColorFormMock() {
  return (
    <PhoneFrame title="Branding Colors">
      <div className="p-4 space-y-4 bg-neutral-50">
        <p className="text-[11px] leading-snug text-neutral-500">
          Customize your community's accent colors. Used for buttons, links, and
          other interactive elements.
        </p>

        <ColorRow label="Primary Color" hex="#6B4423" swatch="bg-primary-700" />
        <ColorRow label="Secondary Color" hex="#C2884E" swatch="bg-accent-500" />

        {/* Live preview chip */}
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2">
            Live preview
          </p>
          <div className="flex items-center gap-2">
            <button className="rounded-lg bg-primary-700 px-3 py-1.5 text-xs font-semibold text-white">
              Join group
            </button>
            <span className="rounded-lg border border-accent-500 px-3 py-1.5 text-xs font-semibold text-accent-600">
              Learn more
            </span>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

/** Final preview: logo, name, and a themed action button. */
function PreviewMock() {
  return (
    <PhoneFrame title="Preview">
      <div className="bg-neutral-50">
        {/* Themed header */}
        <div className="bg-primary-700 px-4 py-4 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/90 text-primary-800 text-sm font-bold">
            GC
          </span>
          <span className="text-sm font-semibold text-white">
            Grace Community Church
          </span>
        </div>
        <div className="p-4 space-y-3">
          <div className="rounded-xl border border-neutral-200 bg-white p-3">
            <div className="flex items-center gap-2 mb-2">
              <Avatar label="AM" />
              <div className="text-xs">
                <p className="font-semibold text-neutral-800">
                  Young Adults Group
                </p>
                <p className="text-neutral-400">Wednesdays · 7:00 PM</p>
              </div>
            </div>
            <button className="w-full rounded-lg bg-primary-700 py-2 text-xs font-semibold text-white">
              RSVP
            </button>
          </div>
          <p className="text-center text-[11px] text-neutral-400">
            Looks good? Save to apply across your community.
          </p>
        </div>
      </div>
    </PhoneFrame>
  );
}

/* --- tiny shared field helpers for the mocks --- */

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-xs font-medium text-neutral-500">
      {children}
    </label>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-800">
        {value}
      </div>
    </div>
  );
}

function ColorRow({
  label,
  hex,
  swatch,
}: {
  label: string;
  hex: string;
  swatch: string;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <span
          className={`h-9 w-9 flex-shrink-0 rounded-lg border border-neutral-200 ${swatch}`}
        />
        <div className="flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm font-mono text-neutral-700">
          {hex}
        </div>
      </div>
    </div>
  );
}
