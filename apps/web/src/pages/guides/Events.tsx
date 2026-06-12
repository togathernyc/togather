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
  { id: "group", label: "Group events" },
  { id: "rsvp", label: "RSVP & attendance" },
  { id: "cwe", label: "Community-wide events" },
  { id: "override", label: "Leaders can customize their copy" },
];

/**
 * Guide post: "Create event plans & community-wide events."
 *
 * Reconstructs three in-app screens as code mockups (group create-event form,
 * an event card with RSVP, and a community-wide event form). Field names and
 * behavior are kept in sync with the backend:
 *   - meeting fields: apps/convex/functions/meetings/events.ts
 *     (title, scheduledAt, meetingType 1=in-person 2=online, meetingLink,
 *      note, coverImage, rsvpEnabled, rsvpOptions, visibility)
 *   - RSVP options: apps/convex/lib/meetingConfig.ts
 *     (1 = Going, 2 = Maybe, 3 = Can't Go)
 *   - community-wide behavior: apps/convex/functions/communityWideEvents.ts
 *     (scope = community + group type, spawns a meeting for every active group,
 *      isOverridden breaks the cascade so leaders can customize their copy)
 */
export function Events() {
  return (
    <GuideLayout slug="events" toc={toc}>
      <Lead>
        Events are what keep your groups actually gathering. With Togather you
        can schedule a single small-group meetup, or roll out one church-wide
        push that lands on every team's calendar at once — all from a quick form
        on your phone.
      </Lead>

      <Section id="group" title="Group events">
        <P>
          The everyday case: a group leader schedules a meeting inside their own
          group. You give it a title, pick a date and time, choose whether it's
          in person or online, and add either a location or a meeting link. An
          optional note and cover image make it feel warm and on-brand, and RSVP
          lets people tell you they're coming.
        </P>

        <Steps>
          <Step n={1}>
            From your group, open the leader tools and tap{" "}
            <Term>Create event</Term>.
          </Step>
          <Step n={2}>
            Add a <Term>Title</Term> and pick a <Term>Date &amp; Time</Term>.
          </Step>
          <Step n={3}>
            Choose <Term>In-person</Term> or <Term>Online Event</Term>. For an
            in-person event, enter a <Term>Location</Term> (or mark{" "}
            <Term>Location TBD</Term>); for an online one, paste a{" "}
            <Term>meeting link</Term>.
          </Step>
          <Step n={4}>
            Optionally add a description and a cover image, leave{" "}
            <Term>RSVP</Term> on, and save.
          </Step>
        </Steps>

        <Figure caption="Creating an event inside a single group.">
          {/* swap-in: <img src="/images/guides/events-create.png" /> */}
          <CreateEventMock />
        </Figure>
      </Section>

      <Section id="rsvp" title="RSVP & attendance">
        <P>
          Once an event is posted, members RSVP right from the event card —{" "}
          <Term>Going</Term>, <Term>Maybe</Term>, or <Term>Can't Go</Term>. As a
          leader you can see who's coming and watch the going count climb, so you
          know what to plan for. After the event, attendance can be confirmed so
          your records reflect who actually showed up.
        </P>

        <Figure caption="An event card with RSVP options and a live going count.">
          {/* swap-in: <img src="/images/guides/events-rsvp.png" /> */}
          <EventCardMock />
        </Figure>

        <Callout tone="note" title="Live preview">
          This is the real in-app events list running right here in your browser
          — the same component members see on their phones, grouped by Today,
          Tomorrow, and the week ahead with live RSVP counts.
        </Callout>

        <Figure caption="The live events list: upcoming gatherings with dates, hosting group, and a running going count.">
          <EventsLiveDemo />
        </Figure>

        <Callout tone="note">
          The going count is the number of people who tapped <Term>Going</Term>.
          You can preview who's attending at a glance before the doors even open,
          which makes setting out chairs and coffee a lot easier.
        </Callout>
      </Section>

      <Section id="cwe" title="Community-wide events">
        <P>
          Sometimes you want every group of a kind to gather on the same night —
          a shared study, a service push, a prayer evening. That's a
          community-wide event. As an admin you create one event scoped to your
          community and a <Term>group type</Term>, and Togather automatically
          creates a meeting for every active group of that type. Schedule a study
          night for <Term>Small Groups</Term> once, and all of them get the same
          meeting on the same date.
        </P>

        <Steps>
          <Step n={1}>
            Open <Term>Community-wide events</Term> from your admin area.
          </Step>
          <Step n={2}>
            Add a <Term>Title</Term>, a <Term>Date &amp; Time</Term>, and choose
            in person or online just like a group event.
          </Step>
          <Step n={3}>
            Pick the <Term>group type</Term> the event applies to — Togather
            shows how many active groups it will create meetings for.
          </Step>
          <Step n={4}>
            Save, and a meeting lands in every one of those groups at once. (If
            no active groups of that type exist yet, you'll be asked to create
            some first.)
          </Step>
        </Steps>

        <Figure caption="A community-wide event scoped to a group type.">
          {/* swap-in: <img src="/images/guides/events-community-wide.png" /> */}
          <CommunityWideEventMock />
        </Figure>

        <DeepLink href={appLinks.communityWideEvents}>
          Open community-wide events
        </DeepLink>
      </Section>

      <Section id="override" title="Leaders can customize their copy">
        <P>
          A church-wide plan shouldn't box anyone in. Each group's leader can
          override their own copy of a community-wide event — nudge the time,
          change the location — without touching anyone else's. Only that group's
          meeting changes; every other group keeps the original.
        </P>

        <Callout tone="tip">
          Overrides are smart. The moment a leader customizes their meeting it's
          marked as overridden and stops following the parent event. Groups that
          haven't been customized still update automatically if you, the admin,
          later edit the parent — so a single tweak keeps every un-touched group
          in sync.
        </Callout>
      </Section>
    </GuideLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Page-local UI mockups                                              */
/* ------------------------------------------------------------------ */

/**
 * Live preview: embeds the REAL mobile events list (rendered via
 * react-native-web with mock data) from /demo/events.html inside a phone frame.
 */
function EventsLiveDemo() {
  return (
    <PhoneFrame title="Events">
      <iframe
        src="/demo/events.html"
        title="Live events list preview"
        className="w-full h-full block border-0"
      />
    </PhoneFrame>
  );
}

/** (a) Create-event form for a single group. */
function CreateEventMock() {
  return (
    <PhoneFrame title="New Event">
      <div className="space-y-3 bg-white p-3">
        <div>
          <div className="mb-1 text-[11px] font-medium text-neutral-500">
            Title
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800">
            Tuesday Dinner &amp; Study
          </div>
        </div>

        <div>
          <div className="mb-1 text-[11px] font-medium text-neutral-500">
            Date &amp; Time
          </div>
          <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm">
            <span className="text-neutral-900">Tue, Jun 16 · 7:00 PM</span>
            <span className="text-neutral-400">▾</span>
          </div>
        </div>

        <div>
          <div className="mb-1 text-[11px] font-medium text-neutral-500">
            Location type
          </div>
          <div className="flex gap-2">
            <span className="flex-1 rounded-lg border border-primary-600 bg-primary-600 px-3 py-1.5 text-center text-[12px] font-semibold text-white">
              In-person
            </span>
            <span className="flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-center text-[12px] font-medium text-neutral-600">
              Online
            </span>
          </div>
        </div>

        <div>
          <div className="mb-1 text-[11px] font-medium text-neutral-500">
            Location
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800">
            114 Grace Ave · Apt 3
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-3">
          <div className="text-sm font-semibold text-neutral-900">RSVP</div>
          <span className="flex h-5 w-9 items-center rounded-full bg-primary-600 px-0.5">
            <span className="ml-auto h-4 w-4 rounded-full bg-white" />
          </span>
        </div>

        <button className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white">
          Create event
        </button>
      </div>
    </PhoneFrame>
  );
}

/** (b) Event card showing date, location, and RSVP buttons with a count. */
function EventCardMock() {
  const guests = [
    { label: "JD", color: "bg-primary-400" },
    { label: "MK", color: "bg-accent-500" },
    { label: "RS", color: "bg-amber-500" },
  ];
  return (
    <PhoneFrame title="Event">
      <div className="bg-neutral-50 p-3">
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
          <div className="flex h-20 items-center justify-center bg-gradient-to-br from-primary-200 to-primary-400 text-2xl">
            🍽️
          </div>
          <div className="space-y-3 p-3">
            <div>
              <div className="text-sm font-bold text-neutral-900">
                Tuesday Dinner &amp; Study
              </div>
              <div className="mt-1 text-[11px] text-neutral-500">
                Tue, Jun 16 · 7:00 PM
              </div>
              <div className="text-[11px] text-neutral-500">
                114 Grace Ave · Apt 3
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex -space-x-2">
                {guests.map((g) => (
                  <Avatar key={g.label} label={g.label} color={g.color} />
                ))}
              </div>
              <span className="text-[11px] font-medium text-neutral-600">
                12 going
              </span>
            </div>

            <div className="flex gap-2">
              <span className="flex-1 rounded-lg border border-primary-600 bg-primary-600 px-2 py-1.5 text-center text-[12px] font-semibold text-white">
                Going
              </span>
              <span className="flex-1 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-center text-[12px] font-medium text-neutral-600">
                Maybe
              </span>
              <span className="flex-1 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-center text-[12px] font-medium text-neutral-600">
                Can't Go
              </span>
            </div>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

/** (c) Community-wide event form with a group-type selector. */
function CommunityWideEventMock() {
  return (
    <PhoneFrame title="New Event">
      <div className="space-y-3 bg-white p-3">
        <div>
          <div className="mb-1 text-[11px] font-medium text-neutral-500">
            Title
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800">
            Church-wide Study Night
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-primary-200 bg-primary-50 p-3">
          <div className="text-sm font-semibold text-primary-800">
            Community-wide event
          </div>
          <span className="flex h-5 w-9 items-center rounded-full bg-primary-600 px-0.5">
            <span className="ml-auto h-4 w-4 rounded-full bg-white" />
          </span>
        </div>

        <div>
          <div className="mb-1 text-[11px] font-medium text-neutral-500">
            Group type
          </div>
          <div className="flex items-center justify-between rounded-lg border border-primary-300 bg-white px-3 py-2 text-sm">
            <span className="font-medium text-neutral-900">Small Groups</span>
            <span className="text-neutral-400">▾</span>
          </div>
          <div className="mt-1.5 rounded-lg bg-accent-400/10 px-3 py-2 text-[11px] font-medium text-neutral-700">
            This will create meetings for 6 groups.
          </div>
        </div>

        <button className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white">
          Schedule event
        </button>
      </div>
    </PhoneFrame>
  );
}
