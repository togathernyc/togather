import { Link } from "react-router-dom";
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

const toc: TocItem[] = [
  { id: "overview", label: "How pricing works" },
  { id: "active-member", label: "What counts as an active member?" },
  { id: "estimate", label: "What will it cost my church?" },
  { id: "test-for-a-dollar", label: "Can I try it for $1?" },
  { id: "when-counted-charged", label: "When do you count and charge?" },
  { id: "see-count", label: "Where do I see my count?" },
  { id: "fees", label: "Are there any extra fees?" },
  { id: "beta-lock-in", label: "$1 is beta pricing — lock it in" },
  { id: "self-host", label: "Prefer to run it yourself?" },
];

export function Pricing() {
  return (
    <GuideLayout slug="pricing" toc={toc}>
      <Lead>
        Togather costs <Term>$1 per active member per month</Term> — and an
        active member is simply someone who opened the app in your community in
        the last 30 days. You only ever pay for the people actually using it, so
        we only grow as you grow. Here's exactly how that works, what a real
        church tends to pay, and how to see your number in real time.
      </Lead>

      <Section id="overview" title="How pricing works">
        <P>
          Pricing is deliberately simple: <Term>$1 per active member per
          month</Term>. There are no tiers, no seat packs to buy, and no
          per-feature upsells. Whether you have 50 active members or 5,000, each
          one costs the same $1 — member #251 costs exactly what member #51
          does.
        </P>
        <P>
          Because the bill follows real usage, it moves with your church. When
          people join and start opening the app, they're counted; when they
          drift away, they roll off. You never pay for a name sitting on a
          roster who hasn't opened Togather in months.
        </P>
        <Callout tone="tip" title="We only grow as you grow">
          You only ever pay for people who are actually using the app. Nothing
          to prune, no seats to manage — the count is fully automatic, and it
          always reflects who's really on Togather this month.
        </Callout>
      </Section>

      <Section id="active-member" title="What counts as an active member?">
        <P>
          An <Term>active member</Term> is a real account (not a demo or
          placeholder) who <em>opened the app in your community within the past
          30 days</em>. That's the whole rule — a single, rolling 30-day
          activity window.
        </P>
        <P>
          This is the same number shown on the <Term>Active Members</Term> card
          on your admin Stats tab, so the figure you're billed for is never a
          mystery: it's the live count you can already see in the app. There's no
          way to manually mark someone active or inactive — the 30-day activity
          rule is the single source of truth, which keeps the number honest for
          everyone.
        </P>
        <P>
          Active members are counted <em>per community</em>. If someone is part
          of two churches on Togather, their activity in one never makes them
          billable in the other.
        </P>
      </Section>

      <Section id="estimate" title="What will it cost my church?">
        <P>
          Because you pay for <em>active</em> members rather than your whole
          roster, the realistic number is usually much lower than a church
          expects. As a rule of thumb, only about a third of a church's members
          are active in any given month.
        </P>
        <P>
          So a <Term>1,000-member church</Term> should expect to pay roughly{" "}
          <Term>$300/month</Term>, not $1,000: about a third of 1,000 is ~300
          active members, at $1 each, is ~$300/month. Treat that as a realistic
          estimate rather than a guarantee — your actual mix depends on how your
          congregation uses the app — but it's a far better starting point than
          multiplying your entire directory by a dollar.
        </P>
        <Figure caption="The Active Members card on your admin Stats tab is your live bill preview — this exact count is what you're billed for.">
          {/* swap-in: <img src="/images/guides/active-members-card.png" /> */}
          <ActiveMembersMock />
        </Figure>
      </Section>

      <Section id="test-for-a-dollar" title="Can I try it for $1?">
        <P>
          Yes. You can go live with just yourself — one active member is one
          dollar a month — and kick the tires on the real thing before anyone
          else joins. It's the full, live product, not a limited trial.
        </P>
        <Callout tone="tip" title="Test it out for $1, then invite your church">
          Go live as a church of one, make sure everything feels right, then
          invite your congregation when you're ready. Your bill grows only as
          they actually start using it.
        </Callout>
      </Section>

      <Section
        id="when-counted-charged"
        title="When do you count members and charge me?"
      >
        <P>
          Two dates matter, and there are no surprises between them:
        </P>
        <P>
          <strong>The 28th — we count.</strong> A sync runs on the 28th of each
          month and snapshots your current active-member count. Anyone who
          joined or went dormant mid-month is simply reflected in that snapshot,
          and mid-month changes after the 28th land in the next month's count.
        </P>
        <P>
          <strong>The 1st — we charge.</strong> Your subscription bills on the
          1st of each month for the coming month (billing in advance). Because
          the count was just taken a few days earlier, the charge on the 1st is
          exactly what you'd expect.
        </P>
        <Callout tone="tip" title="A preview before every charge">
          In the few days between the 28th sync and the 1st, admins get an email
          previewing exactly what the 1st will charge. No surprise invoices.
        </Callout>
      </Section>

      <Section id="see-count" title="Where do I see my active-member count?">
        <P>
          Open the <Term>Active Members</Term> card on your admin{" "}
          <Term>Stats</Term> tab. It shows the exact count you'll be billed for
          and updates continuously as people open the app, so it doubles as a
          real-time bill preview between billing dates.
        </P>
        <DeepLink href={appLinks.admin}>Open the admin dashboard</DeepLink>
      </Section>

      <Section id="fees" title="Are there any extra fees?">
        <P>
          No hidden ones. The <Term>$1 per active member</Term> is the whole
          software price — payment processing is already included, so there's
          no card fee tacked on. The only thing added on top is{" "}
          <strong>sales tax</strong>, where applicable, which is calculated at
          checkout and shown as its own line on your invoice.
        </P>
        <Callout tone="note" title="Just $1/member, plus tax where it applies">
          Sales tax on software is required in a number of states, so like any
          SaaS you'll see it added on top when it applies to your church.
          Everything else — including card processing — is covered by the
          $1/member.
        </Callout>
      </Section>

      <Section id="beta-lock-in" title="$1 is beta pricing — lock it in">
        <P>
          $1 per active member is <Term>beta pricing</Term>. As Togather grows,
          prices can and will change. But churches who start now lock in{" "}
          $1/member for as long as they keep their subscription.
        </P>
        <Callout tone="tip" title="Start now to lock it in forever">
          Beginning while it's $1/active member locks that rate in for as long
          as your subscription stays active — even after prices rise for
          everyone else. The simplest way to keep $1/member forever is to start
          now.
        </Callout>
      </Section>

      <Section id="self-host" title="Prefer to run it yourself?">
        <P>
          Togather is open source under the AGPL-3.0 license, so self-hosting is
          always free: clone the{" "}
          <a
            href="https://github.com/togathernyc/togather"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-700 underline hover:text-primary-800"
          >
            repository
          </a>{" "}
          and run your own deployment, or see our{" "}
          <Link
            to="/contribute"
            className="text-primary-700 underline hover:text-primary-800"
          >
            contribute page
          </Link>
          .
        </P>
      </Section>
    </GuideLayout>
  );
}

/* -------------------------------------------------------------------------- */
/* Page-local UI mocks                                                        */
/* -------------------------------------------------------------------------- */

function ActiveMembersMock() {
  return (
    <PhoneFrame title="Stats">
      <div className="p-4 bg-neutral-50 min-h-full">
        <div className="rounded-2xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.08)]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-neutral-900">
              Active Members
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-700 bg-accent-400/15 rounded-full px-2 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-600" />
              Live
            </span>
          </div>
          <div className="text-5xl font-bold text-neutral-900 leading-none mb-2">
            312
          </div>
          <div className="text-xs text-neutral-500 leading-snug">
            Opened the app in the last 30 days — this is what you're billed for.
          </div>
          <div className="mt-4 border-t border-neutral-100 pt-3 flex items-center justify-between">
            <span className="text-xs text-neutral-500">Estimated monthly bill</span>
            <span className="text-sm font-semibold text-neutral-900">$312</span>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}
