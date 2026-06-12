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
  { id: "enable", label: "Turn on prayer" },
  { id: "use", label: "How members use it" },
  { id: "answered", label: "Answered prayers & follow-ups" },
  { id: "moderation", label: "Safe & moderated" },
];

/**
 * Guide post: "Enable the prayer feature."
 *
 * Reconstructs three in-app screens as code mockups (church-features settings
 * with the Prayer toggle, the prayer feed, and a prayer detail). UI labels are
 * kept in sync with the mobile prayer feature (apps/mobile/features/prayer/*)
 * and the church-feature flag (churchFeatures.prayerEnabled in
 * apps/convex/functions/admin/settings.ts).
 */
export function Prayer() {
  return (
    <GuideLayout slug="prayer" toc={toc}>
      <Lead>
        Prayer is a Togather feature your church can switch on so members can
        carry one another's requests. When it's on, your community gets a place
        to share what's on their heart and to quietly pray for each other —
        right inside the app they already use.
      </Lead>

      <Section id="enable" title="Turn on prayer">
        <P>
          Prayer is off until an admin turns it on. You'll find it in{" "}
          <Term>Admin → Settings</Term>, under the{" "}
          <Term>Church Features</Term> card — flip the{" "}
          <Term>Prayer Requests</Term> toggle and a Prayer tab appears for your
          members. Nothing changes for anyone until you do this, so you're free
          to turn it on whenever your church is ready.
        </P>

        <Steps>
          <Step n={1}>
            Open <Term>Admin</Term> and go to the <Term>Settings</Term> tab.
          </Step>
          <Step n={2}>
            Scroll to the <Term>Church Features</Term> card ("Opt-in features
            for religious communities. Off by default.").
          </Step>
          <Step n={3}>
            Find <Term>Prayer Requests</Term> and switch the toggle on. This
            adds a Prayer tab where members post and pray. Toggle it back off
            any time and the tab goes away.
          </Step>
        </Steps>

        <Figure caption="Admin → Settings → Church Features — flip Prayer Requests on.">
          {/* swap-in: <img src="/images/guides/prayer-settings.png" /> */}
          <ChurchFeaturesMock />
        </Figure>

        <DeepLink href={appLinks.features}>Open admin settings</DeepLink>
      </Section>

      <Section id="use" title="How members use it">
        <P>
          Once prayer is on, any member can post a prayer request — and they can
          choose to post it <Term>Anonymously</Term> if it's tender. Others then
          pray for it: tapping <Term>Pray</Term> opens a short, unhurried prayer
          time ("Take 3 minutes to pray for this request"). When they're done —
          either the timer finishes or they tap <Term>I prayed, mark done</Term>{" "}
          — the request's pray count goes up.
        </P>
        <P>
          The feed is gentle by design. Rather than a firehose, it surfaces the
          requests that need prayer most — the ones with the fewest prayers so
          far — so newer and quieter requests don't get lost behind the popular
          ones. Each card shows the request, how many people have prayed (
          <Term>Be the first to pray</Term> when none have yet), and the{" "}
          <Term>Pray</Term> button.
        </P>

        <Figure caption="The prayer feed — each request shows a pray count and a Pray button.">
          {/* swap-in: <img src="/images/guides/prayer-feed.png" /> */}
          <PrayerFeedMock />
        </Figure>

        <Callout tone="note" title="Live preview">
          The phone below is the real <Term>Prayer</Term> screen from the
          Togather app, running here with sample requests and no backend.
        </Callout>
        <Figure caption="The actual prayer feed rendered on the web, in dark mode with the app's own theme.">
          <LivePrayerDemo />
        </Figure>
      </Section>

      <Section id="answered" title="Answered prayers & follow-ups">
        <P>
          A prayer request isn't just a one-off post. The person who shared it
          can come back to add an <Term>Update</Term> or a{" "}
          <Term>Praise report</Term> for everyone who prayed, and when God moves
          they can tap <Term>Mark answered</Term> to celebrate it. Everyone who
          prayed gets notified of the follow-up, so the people who carried the
          request get to share the joy.
        </P>
        <P>
          Once a request has run its course, the author can <Term>Archive</Term>{" "}
          it — that hides it from the feed but keeps it under their own My
          Prayers list. Older requests are tidied away on their own over time,
          so the feed stays current without anyone having to clean up.
        </P>

        <Figure caption="A prayer's detail view — mark it answered and share a praise report.">
          {/* swap-in: <img src="/images/guides/prayer-detail.png" /> */}
          <PrayerDetailMock />
        </Figure>

        <Callout tone="tip">
          Encourage your members to post praise reports when prayers are
          answered. Seeing answered prayer roll back through the people who
          prayed is one of the most encouraging things a praying community can
          experience.
        </Callout>
      </Section>

      <Section id="moderation" title="Safe & moderated">
        <P>
          A prayer feed touches tender things, so it's built to be overseeable.
          Any member can report a request they're concerned about, and those
          reports come straight to your admins to review — keep it up or take it
          down. Borderline posts are held for an admin to approve before they go
          public, and you'll find them under <Term>Prayer Reviews</Term> in your
          admin area.
        </P>
        <P>
          On top of that, the system quietly flags sensitive content — for
          example a request that hints at someone in crisis — and surfaces
          caring resources alongside it rather than hiding the post. The
          guiding idea is triage, not suppression: people in pain still get
          seen and prayed for.
        </P>

        <Callout tone="note">
          You're never on the hook to read every prayer. The system does the
          first pass and only routes the handful that genuinely need human eyes
          to you — so prayer stays a blessing to run, not a burden.
        </Callout>
      </Section>
    </GuideLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Page-local UI mockups                                              */
/* ------------------------------------------------------------------ */

/** Live demo: the real PrayerScreen rendered via react-native-web (see /demo). */
function LivePrayerDemo() {
  return (
    <PhoneFrame>
      <iframe
        src="/demo/prayer-feed.html"
        title="Live Togather prayer feed demo"
        className="w-full h-full block border-0"
      />
    </PhoneFrame>
  );
}

/** (a) Admin → Settings → "Church Features" card with the Prayer Requests row. */
function ChurchFeaturesMock() {
  return (
    <PhoneFrame title="Settings">
      <div className="bg-neutral-50 p-3">
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          {/* Card header */}
          <div className="mb-1 text-sm font-semibold text-neutral-900">
            Church Features
          </div>
          <div className="mb-3 text-[11px] leading-snug text-neutral-500">
            Opt-in features for religious communities. Off by default.
          </div>

          {/* Prayer Requests row */}
          <div className="flex items-start gap-3 border-t border-neutral-100 pt-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-neutral-900">
                Prayer Requests
              </div>
              <div className="text-[11px] leading-snug text-neutral-500">
                Members can post prayer requests and pray for each other. Adds a
                Prayer tab.
              </div>
            </div>
            {/* On switch */}
            <span className="mt-0.5 flex h-5 w-9 flex-shrink-0 items-center rounded-full bg-accent-500 px-0.5">
              <span className="ml-auto h-4 w-4 rounded-full bg-white" />
            </span>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

/**
 * (b) The prayer screen — one request at a time (NOT a scrolling feed).
 * Matches apps/mobile/features/prayer/components/PrayerScreen.tsx: a heading,
 * add + "My prayers" actions, a "Prayer N of 3" progress row with dots, and a
 * single hero card (initials avatar, author, time · others prayed, an oversized
 * quote mark in the community color, the request, and a solid Pray button).
 */
function PrayerFeedMock() {
  return (
    <PhoneFrame title="Prayer">
      <div className="bg-neutral-50 px-4 pb-4 pt-3">
        {/* Top bar: heading + add / my prayers */}
        <div className="mb-3 flex items-center justify-between">
          <div className="text-base font-bold text-neutral-900">
            Pray for your community
          </div>
          <div className="flex items-center gap-3 text-primary-600">
            <span className="text-lg leading-none">+</span>
            <span className="text-[12px] font-semibold">My prayers</span>
          </div>
        </div>

        {/* Progress row: "Prayer 1 of 3" + three dots */}
        <div className="mb-5 flex items-center gap-2.5">
          <span className="text-[12px] font-semibold tracking-wide text-neutral-500">
            Prayer 1 of 3
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-neutral-300" />
            <span className="h-2 w-2 rounded-full bg-neutral-300" />
            <span className="h-2 w-2 rounded-full bg-neutral-300" />
          </span>
        </div>

        {/* Single hero prayer card */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            {/* Initials avatar on a pastel background — never a photo. */}
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[#A0C4FF] text-sm font-bold text-[#3A3A3F]">
              SM
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-bold text-neutral-900">
                Sarah M.
              </div>
              <div className="text-[12px] text-neutral-400">
                2h ago · 3 others prayed
              </div>
            </div>
            <span className="text-neutral-400">⋯</span>
          </div>

          {/* Body with oversized decorative opening quote */}
          <div className="relative mb-5 pl-6 pr-1 pt-2">
            <span className="absolute -left-0.5 -top-3 select-none text-6xl font-bold leading-none text-primary-600 opacity-35">
              “
            </span>
            <p className="text-[18px] font-medium leading-7 text-neutral-900">
              Wisdom for a big decision at work this week.
            </p>
          </div>

          <button className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-3.5 text-[15px] font-bold text-white">
            <span>♥</span> Pray
          </button>
        </div>
      </div>
    </PhoneFrame>
  );
}

/** (c) Prayer detail — Mark answered action and a praise-report follow-up. */
function PrayerDetailMock() {
  return (
    <PhoneFrame title="Prayer">
      <div className="space-y-3 bg-neutral-50 p-3">
        {/* Request body */}
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <div className="mb-2.5 text-sm leading-snug text-neutral-800">
            Please pray for my mom's surgery on Thursday.
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
            <span>👥</span>
            <span>12 people prayed</span>
          </div>
        </div>

        {/* Author lifecycle actions */}
        <div className="flex gap-2">
          <button className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent-500 py-2 text-[12px] font-semibold text-white">
            <span>✓</span> Mark answered
          </button>
          <button className="flex items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[12px] font-semibold text-neutral-700">
            <span>🗄</span> Archive
          </button>
        </div>

        {/* Follow-up: praise report */}
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
            Updates
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-3">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="rounded-md bg-accent-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                Praise report
              </span>
              <Avatar label="JD" color="bg-primary-400" />
            </div>
            <div className="text-[13px] leading-snug text-neutral-700">
              Surgery went well — thank you all for praying. God is good!
            </div>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}
