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
  { id: "demo", label: "Try it in a demo first" },
  { id: "request", label: "Request your community" },
  { id: "pricing", label: "Fair pricing & review" },
  { id: "self-host", label: "If you're turned down" },
  { id: "next", label: "What comes next" },
];

export function CreateCommunity() {
  return (
    <GuideLayout slug="create-your-community" toc={toc}>
      <Lead>
        Every church on Togather starts the same way: by requesting its own
        community. This guide walks you through that first step — from finding
        the request form to hearing back from our team — so your congregation
        has a home of its own.
      </Lead>

      <Section id="switcher" title="Open the community switcher">
        <P>
          The community switcher is where you move between the communities you
          already belong to and where you ask for a brand-new one. If your
          church isn't on Togather yet, this is your starting point.
        </P>
        <P>
          Open the switcher, scroll past the communities you can already see,
          and look at the bottom of the screen. <Term>Try a Demo for Your
          Church</Term> spins up a private, seeded sandbox you can explore
          right away, and <Term>Create a Community</Term> opens the{" "}
          <Term>Propose a Community</Term> form in your browser.
        </P>
        <DeepLink href={appLinks.communitySwitcher}>
          Open the community switcher
        </DeepLink>

        <Figure caption="The Select Community screen: pick a community you belong to, search for another, or create your own.">
          {/* swap-in: <img src="/images/guides/community-switcher.png" /> */}
          <CommunitySwitcherMock />
        </Figure>
      </Section>

      <Section id="demo" title="Try it in a demo first">
        <P>
          Not ready to commit? You can see exactly how Togather would look for
          your church before requesting anything. Tap <Term>Try a Demo for
          Your Church</Term> in the switcher and answer a few quick questions:
        </P>
        <Steps>
          <Step n={1}>
            <Term>Church name</Term> — your demo community is named after your
            church from the start.
          </Step>
          <Step n={2}>
            <Term>Church size</Term>, <Term>Campuses</Term>, and{" "}
            <Term>Small groups</Term> — we scale the demo's groups and people
            to roughly match your congregation.
          </Step>
          <Step n={3}>
            <Term>Main zip code</Term> — so the community's home base matches
            yours.
          </Step>
          <Step n={4}>
            <Term>Logo</Term> and <Term>brand colors</Term> — the whole app is
            themed with your look before you ever open it.
          </Step>
        </Steps>
        <P>
          Choose <Term>Create my demo</Term> and in a few seconds you're the
          admin of a working community: seeded groups with real channel
          conversations, upcoming events with RSVPs, prayer requests, and the
          full admin settings screen. Everything works — rename it, re-brand
          it, create events, post messages.
        </P>
        <Callout tone="tip" title="Explore it with your whole team">
          Your demo comes with a <Term>demo code</Term>. Anyone on your staff
          who enters that code on the demo page joins the same sandbox as a
          co-admin, so several people can click around and make changes at the
          same time.
        </Callout>
        <P>
          Demo communities are private — they never show up in community
          search — and there's no payment or commitment involved. When you're
          ready for the real thing, continue below.
        </P>
        <DeepLink href={appLinks.demo}>Start a demo community</DeepLink>
      </Section>

      <Section id="request" title="Request your community">
        <P>
          Proposing a community is a short form — just enough for us to
          understand your congregation and get you set up. Here's what you'll
          fill in:
        </P>
        <Steps>
          <Step n={1}>
            <Term>Community Name</Term> — what your church will be called on
            Togather (for example, "Grace Church NYC"). You can refine the
            display name later during setup.
          </Step>
          <Step n={2}>
            <Term>Estimated Number of People</Term> — roughly how many people
            you expect in your community. A close estimate is fine.
          </Step>
          <Step n={3}>
            <Term>Proposed Monthly Price</Term> — the monthly amount your church
            can sustainably contribute. More on how to think about this just
            below.
          </Step>
          <Step n={4}>
            <Term>Need Help Migrating?</Term> — flip this on if you're moving
            over from another tool. (Migration assistance is a one-time $500
            flat fee.)
          </Step>
          <Step n={5}>
            <Term>Additional Notes</Term> — anything else you'd like us to know
            about your congregation. Optional, but helpful.
          </Step>
          <Step n={6}>
            <Term>Contact Email</Term> — where we'll send updates about your
            request. (It appears at the top of the form, and only if we don't
            already have an email on file for you.)
          </Step>
        </Steps>
        <P>
          When everything looks right, choose <Term>Submit Proposal</Term>.
          You'll see a confirmation that we've received it, and the rest happens
          over email.
        </P>

        <Figure caption="The Propose a Community form. A close estimate and an honest price are all we need to start.">
          {/* swap-in: <img src="/images/guides/community-request-form.png" /> */}
          <RequestFormMock />
        </Figure>
      </Section>

      <Section id="pricing" title="Fair pricing & review">
        <P>
          Togather is open-source and sustainably funded — not free at any
          scale. Running the service costs real money, so instead of a fixed
          price list we ask you to propose what your church can fairly and
          sustainably pay each month. A small congregation and a large one will
          land in very different places, and that's by design.
        </P>
        <Callout tone="tip" title="Not sure what to propose?">
          Add up what you're paying today. Togather replaces several tools at
          once — Planning Center for service planning and rostering, Slack or
          GroupMe for team chat, texting tools like Clearstream, and
          event/RSVP tools. The combined monthly total of whatever you
          currently pay for those is a fair starting point: you're
          consolidating, not adding a line item.
        </Callout>
        <P>
          Every request is reviewed by hand. Our admins look at your proposal
          and decide whether we can responsibly support a congregation of your
          size at the price you've offered.
        </P>
        <Callout tone="note" title="How review works">
          Your request starts as <Term>pending</Term>. From there it becomes
          either <Term>accepted</Term> or <Term>rejected</Term>. When it's
          accepted, three things happen automatically: you become the
          community's primary admin, an announcements group is created for you,
          and you receive an email with a link to finish setting up your
          community.
        </Callout>
      </Section>

      <Section id="self-host" title="If you're turned down">
        <P>
          Sometimes we can't take a request on — most often because we don't
          think we can responsibly support a congregation at the proposed price.
          If that happens, you still have a path forward.
        </P>
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
          Once your request is accepted and you've followed the setup link, your
          community is real — but it's still wearing default colors. The next
          guide walks you through branding it so it feels unmistakably like your
          church.
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
            Try a Demo for Your Church
          </button>
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

function RequestFormMock() {
  return (
    <PhoneFrame>
      <div className="p-4 bg-neutral-100 min-h-full">
        <div className="text-base font-bold tracking-tight text-neutral-900 mb-3">
          togather
        </div>
        <div className="text-lg font-bold text-neutral-900 mb-1">
          Propose a Community
        </div>
        <div className="text-xs text-neutral-500 leading-snug mb-4">
          Tell us about your community and we'll get you set up on Togather.
        </div>

        <div className="rounded-2xl bg-white p-4 space-y-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <MockField label="Community Name" required value="Grace Church NYC" />
          <MockField
            label="Estimated Number of People"
            required
            value="150"
          />

          <div>
            <div className="text-xs font-semibold text-neutral-900 mb-1">
              Proposed Monthly Price <span className="text-red-500">*</span>
            </div>
            <div className="flex items-center rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
              <span className="text-sm font-medium text-neutral-500 mr-1">
                $
              </span>
              <span className="text-sm text-neutral-900">200</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-900">
                Need Help Migrating?
              </span>
              <span className="inline-flex h-5 w-9 items-center justify-end rounded-full bg-primary-600 p-0.5">
                <span className="h-4 w-4 rounded-full bg-white shadow" />
              </span>
            </div>
            <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-800">
              <span className="font-semibold">ⓘ</span>
              <span>Migration assistance is a one-time $500 flat fee.</span>
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-neutral-900 mb-1">
              Additional Notes{" "}
              <span className="font-normal text-neutral-400">(optional)</span>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-400 leading-snug min-h-[4rem]">
              Anything else you'd like us to know about your community...
            </div>
          </div>

          <button className="w-full rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white">
            Submit Proposal
          </button>
        </div>
      </div>
    </PhoneFrame>
  );
}

function MockField({
  label,
  value,
  required,
}: {
  label: string;
  value: string;
  required?: boolean;
}) {
  return (
    <div>
      <div className="text-xs font-semibold text-neutral-900 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </div>
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900">
        {value}
      </div>
    </div>
  );
}
