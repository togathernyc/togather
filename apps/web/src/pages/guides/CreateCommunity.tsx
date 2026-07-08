import { Link } from "react-router-dom";
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
import { PhoneFrame } from "../../components/guide/PhoneFrame";
import { appLinks } from "../../guides/appLinks";

const toc: TocItem[] = [
  { id: "switcher", label: "Open the community switcher" },
  { id: "demo", label: "Start in demo mode" },
  { id: "team", label: "Explore it with your team" },
  { id: "go-live", label: "Go live: $1 per active member" },
  { id: "self-host", label: "Prefer to run it yourself?" },
  { id: "next", label: "What comes next" },
];

export function CreateCommunity() {
  return (
    <GuideLayout slug="create-your-community" toc={toc}>
      <Lead>
        Every church on Togather starts the same way: by creating its own
        community. There's no request form and no waiting — your community
        starts in <Term>demo mode</Term>, already wearing your name and
        branding, and you take it live whenever you're ready.
      </Lead>

      <Section id="switcher" title="Open the community switcher">
        <P>
          The community switcher is where you move between the communities you
          already belong to and where you create a brand-new one. If your
          church isn't on Togather yet, this is your starting point.
        </P>
        <P>
          Open the switcher, scroll past the communities you can already see,
          and tap <Term>Create a Community</Term> at the bottom of the screen.
        </P>
        <DeepLink href={appLinks.communitySwitcher}>
          Open the community switcher
        </DeepLink>

        <Figure caption="The Select Community screen: pick a community you belong to, search for another, or create your own.">
          {/* swap-in: <img src="/images/guides/community-switcher.png" /> */}
          <CommunitySwitcherMock />
        </Figure>
      </Section>

      <Section id="demo" title="Start in demo mode">
        <P>
          Creating a community is a short questionnaire — just enough for us to
          build something that looks and feels like your church:
        </P>
        <Steps>
          <Step n={1}>
            <Term>Church name</Term> — your community is named after your
            church from the start.
          </Step>
          <Step n={2}>
            <Term>Church size</Term>, <Term>Campuses</Term>, and{" "}
            <Term>Small groups</Term> — we create a group for every campus and
            small group you enter. Naming them is optional: skip it and we'll
            use friendly placeholders you can rename anytime.
          </Step>
          <Step n={3}>
            <Term>Main zip code</Term> — your groups and events are placed on
            the map around your area.
          </Step>
          <Step n={4}>
            <Term>Logo</Term> and <Term>brand color</Term> — pick from preset
            swatches that all work well (richer, darker shades carry the white
            text used on buttons and tabs). The whole app is themed with your
            look before you ever open it.
          </Step>
        </Steps>
        <P>
          Choose <Term>Create my community</Term> and in a few seconds you're
          the admin of a working community in demo mode: 100 seeded demo
          members with real profile photos, groups with avatars and real
          channel conversations, direct messages, upcoming events with cover
          photos and RSVPs, prayer requests, and the full admin settings
          screen. A <Term>🎓 Getting Started</Term> conversation in your inbox
          walks you through the best things to try, and the Go Live screen
          tracks your progress. Everything works — rename it, re-brand it,
          create events, post messages.
        </P>
        <Callout tone="note" title="You'll always know it's a demo">
          While your community is in demo mode, a banner appears across the
          whole app. It's also where admins tap <Term>Go live</Term> when
          they're ready for the real thing.
        </Callout>
        <DeepLink href={appLinks.demo}>Create your community</DeepLink>
      </Section>

      <Section id="team" title="Explore it with your team">
        <P>
          Your demo comes with a <Term>demo code</Term>. Anyone on your staff
          who enters that code on the create-community page joins the same
          demo as a co-admin, so several people can click around and make
          changes at the same time.
        </P>
        <Callout tone="tip" title="Room for your whole staff">
          A demo holds up to <Term>10 real people</Term> alongside the 100
          seeded demo members. That's plenty for a staff team to evaluate
          together — and when you go live, the limit goes away.
        </Callout>
        <P>
          Demo communities are private: they never show up in community
          search, and only people with your demo code can join.
        </P>
      </Section>

      <Section id="go-live" title="Go live: $1 per active member">
        <P>
          When your team is ready, tap <Term>Go live</Term> on the demo banner.
          Going live keeps everything you've set up — name, branding, groups,
          channels, and your staff accounts — and removes the seeded demo
          members and their conversations, so you start clean with your real
          congregation.
        </P>
        <P>
          Pricing is simple: <Term>$1 per active member per month</Term>. An
          active member is someone who opened the app in <em>your</em>{" "}
          community within the past month — the same number as the{" "}
          <Term>Active Members</Term> card on your admin Stats tab, so you can
          always see exactly what you'll pay. Your bill adjusts automatically
          every month as people join, drift away, or come back.
        </P>
        <Callout tone="tip" title="Nothing to manage">
          There's no seat list to prune and no toggles to flip — the count is
          fully automatic. Anyone who stops opening the app rolls off the next
          month, and comes back the month they return. What you pay always
          reflects who's actually using Togather.
        </Callout>
        <P>
          Payment is handled by Stripe. As soon as checkout completes, the
          demo banner disappears and your community is live.
        </P>
      </Section>

      <Section id="self-host" title="Prefer to run it yourself?">
        <P>
          Togather is open source under the AGPL-3.0 license. That means you're
          free to run it yourself: clone the repository and stand up your own
          deployment, fully under your church's control.
        </P>
        <Callout tone="tip" title="Self-hosting is always an option">
          <P>
            The full source lives on GitHub at{" "}
            <a
              href="https://github.com/togathernyc/togather"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-700 underline hover:text-primary-800"
            >
              github.com/togathernyc/togather
            </a>
            . If you'd like a hand getting started — or want to help shape the
            project — see our{" "}
            <Link
              to="/contribute"
              className="text-primary-700 underline hover:text-primary-800"
            >
              contribute page
            </Link>
            .
          </P>
        </Callout>
      </Section>

      <Section id="next" title="What comes next">
        <P>
          Whether you're still in demo mode or freshly live, your community is
          real — and fully yours to shape. The next guide walks you through
          branding it so it feels unmistakably like your church.
        </P>
      </Section>
    </GuideLayout>
  );
}

/* -------------------------------------------------------------------------- */
/* Page-local UI mocks                                                        */
/* -------------------------------------------------------------------------- */

function CommunitySwitcherMock() {
  return (
    <PhoneFrame>
      <div className="p-4 pb-2 bg-white min-h-full flex flex-col">
        <div className="text-center text-xl font-bold text-neutral-900 mt-3 mb-1">
          Select Community
        </div>
        <div className="text-center text-xs text-neutral-500 mb-5 px-2 leading-snug">
          Choose a community to continue or search for a new one
        </div>

        <div className="mb-5">
          <div className="text-sm font-semibold text-neutral-900 mb-2">
            Your Communities
          </div>
          <CommunityRow initials="GP" name="Grace Park Fellowship" slug="gracepark" />
          <CommunityRow
            initials="HC"
            name="Hope City Church"
            slug="hopecity"
            color="bg-accent-500"
          />
        </div>

        <div className="mb-5">
          <div className="text-sm font-semibold text-neutral-900 mb-2">
            Or Join Another
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-neutral-100 px-3 py-2.5">
            <SearchIcon />
            <span className="text-sm text-neutral-400">
              Search communities...
            </span>
          </div>
        </div>

        <div className="mt-auto border-t border-neutral-100 pt-4 space-y-3">
          <div className="text-center text-[11px] text-neutral-500">
            Can't find your community?{" "}
            <span className="font-medium text-primary-700">Contact support</span>
          </div>
          <button className="w-full rounded-xl bg-neutral-100 px-4 py-3 text-center text-sm font-semibold text-neutral-900">
            Create a Community
          </button>
          <div className="text-center text-xs text-neutral-400 underline pb-1">
            Continue without community
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

function CommunityRow({
  initials,
  name,
  slug,
  color = "bg-primary-400",
}: {
  initials: string;
  name: string;
  slug: string;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white p-3.5 mb-2 shadow-[0_1px_4px_rgba(0,0,0,0.08)]">
      <span
        className={`inline-flex items-center justify-center w-11 h-11 rounded-full ${color} text-white text-sm font-semibold flex-shrink-0`}
      >
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-neutral-900 truncate">
          {name}
        </div>
        <div className="text-xs text-neutral-500 truncate">{slug}</div>
      </div>
      <span className="text-neutral-300 text-lg leading-none">›</span>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4 text-neutral-400 flex-shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
