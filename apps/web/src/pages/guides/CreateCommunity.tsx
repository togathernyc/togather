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
import { PhoneFrame, Avatar } from "../../components/guide/PhoneFrame";
import { appLinks } from "../../guides/appLinks";

const toc: TocItem[] = [
  { id: "switcher", label: "Open the community switcher" },
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
          Open the switcher, look past the communities you can already see, and
          choose <Term>Propose a Community</Term>.
        </P>
        <DeepLink href={appLinks.communitySwitcher}>
          Open the community switcher
        </DeepLink>

        <Figure caption="The community switcher: search for an existing community, or propose a new one for your church.">
          {/* swap-in: <img src="/images/guides/community-switcher.png" /> */}
          <CommunitySwitcherMock />
        </Figure>
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
            request. (You'll only see this field if we don't already have an
            email on file for you.)
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
    <PhoneFrame title="Select Community">
      <div className="p-4 space-y-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2">
            Your Communities
          </div>
          <div className="space-y-2">
            <CommunityRow label="GP" name="Grace Park Fellowship" sub="Member" />
            <CommunityRow label="HC" name="Hope City Church" sub="Member" color="bg-accent-500" />
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-2">
            Find a community
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
            <span className="w-3.5 h-3.5 rounded-full border-2 border-neutral-400" />
            <span className="text-sm text-neutral-400">Search communities…</span>
          </div>
        </div>

        <button className="w-full rounded-xl border border-dashed border-primary-300 bg-primary-50 px-4 py-3 text-left">
          <div className="text-sm font-semibold text-primary-800">
            + Propose a Community
          </div>
          <div className="text-xs text-primary-700/80 mt-0.5">
            Request a new community for your church
          </div>
        </button>
      </div>
    </PhoneFrame>
  );
}

function CommunityRow({
  label,
  name,
  sub,
  color,
}: {
  label: string;
  name: string;
  sub: string;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
      <Avatar label={label} color={color} />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-neutral-900 truncate">
          {name}
        </div>
        <div className="text-xs text-neutral-500">{sub}</div>
      </div>
    </div>
  );
}

function RequestFormMock() {
  return (
    <PhoneFrame title="Propose a Community">
      <div className="p-4 space-y-3.5">
        <MockField label="Community Name" value="Grace Church NYC" />
        <MockField label="Estimated Number of People" value="150" />

        <div>
          <div className="text-xs font-semibold text-neutral-700 mb-1">
            Proposed Monthly Price
          </div>
          <div className="flex items-center rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
            <span className="text-sm text-neutral-500 mr-1">$</span>
            <span className="text-sm text-neutral-900">200</span>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-3 py-2.5">
          <span className="text-sm font-semibold text-neutral-700">
            Need Help Migrating?
          </span>
          <span className="inline-flex h-5 w-9 items-center rounded-full bg-neutral-200 p-0.5">
            <span className="h-4 w-4 rounded-full bg-white shadow" />
          </span>
        </div>

        <div>
          <div className="text-xs font-semibold text-neutral-700 mb-1">
            Additional Notes{" "}
            <span className="font-normal text-neutral-400">(optional)</span>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-400 leading-snug min-h-[3rem]">
            Anything else you'd like us to know…
          </div>
        </div>

        <button className="w-full rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white">
          Submit Proposal
        </button>
      </div>
    </PhoneFrame>
  );
}

function MockField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold text-neutral-700 mb-1">{label}</div>
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-900">
        {value}
      </div>
    </div>
  );
}
