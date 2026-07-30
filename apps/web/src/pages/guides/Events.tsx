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
  { id: "what", label: "Events aren't event plans" },
  { id: "anatomy", label: "What an event gives you" },
  { id: "create", label: "Creating an event" },
  { id: "card", label: "The event card" },
  { id: "series", label: "Series: bundle the dates" },
  { id: "cwe", label: "Community-wide events" },
  { id: "combo", label: "The power combo" },
];

/**
 * Guide post: "Events, series & community-wide events."
 *
 * Reconstructs three in-app screens as code mockups (event card, the create
 * event form, and the community-wide events admin screen). Field names and
 * behavior are kept in sync with the backend:
 *   - meeting fields: apps/convex/functions/meetings/events.ts
 *     (title, scheduledAt, meetingType 1=in-person 2=online, meetingLink,
 *      note, coverImage, rsvpEnabled, rsvpOptions, visibility)
 *   - RSVP options: apps/convex/lib/meetingConfig.ts
 *     (1 = Going 👍, 2 = Maybe 🤔, 3 = Can't Go 😢; Maybe can be hidden)
 *   - series: a named bundle of explicit dates (not a recurrence rule); one
 *     meeting is created per selected date and they share a seriesId.
 *   - community-wide behavior: apps/convex/functions/communityWideEvents.ts
 *     (scope = community + group type, spawns a linked meeting for every active
 *      group; isOverridden breaks the cascade so leaders can customize a copy)
 *
 * NOTE: Event *plans* (rostering, run sheets) are a separate feature with its
 * own guide at /guides/event-plans. This guide is strictly about the public,
 * RSVP-able event.
 */
export function Events() {
  return (
    <GuideLayout slug="events" toc={toc}>
      <Lead>
        An event is a full-stack invitation — "the men's group is having a
        picnic." A few taps creates it, texts the group, collects RSVPs with
        plus-ones, and opens a chat just for the people coming. This guide
        covers events, series, and how an admin can light one up across an
        entire community at once.
      </Lead>

      <Section id="what" title="Events aren't event plans">
        <P>
          It's worth drawing one line up front, because the two get confused. An{" "}
          <Term>event</Term> is the public-facing invitation: a picnic, a dinner,
          a service night — something people see, RSVP to, and show up for. An{" "}
          <Term>event plan</Term> is the behind-the-scenes service plan that
          makes a gathering run: rostering volunteers, assigning positions,
          building a run sheet.
        </P>
        <P>
          They're independent. An event might have no plan at all (a casual
          picnic needs no run sheet), and a plan might have no public event (a
          volunteer team can be rostered without ever inviting a crowd). This
          guide is about events. For rostering and run sheets, see the{" "}
          <a
            href="/guides/event-plans"
            className="font-medium text-primary-700 underline decoration-primary-300 underline-offset-2 hover:text-primary-800"
          >
            Event plans guide
          </a>
          .
        </P>
      </Section>

      <Section id="anatomy" title="What an event gives you">
        <P>
          Every event has a <Term>hosting group</Term> and a time and place — an
          address, an online link, or just <Term>Location TBD</Term> — plus a
          description and a poster image you pick from a curated library or
          upload yourself. From there, the event does the legwork:
        </P>

        <Steps>
          <Step n={1}>
            <strong>Invites by text and push.</strong> Invite group members and
            they get an SMS <em>and</em> a push invitation. If turnout's thin,
            fire off another manual reminder round to whoever hasn't responded.
          </Step>
          <Step n={2}>
            <strong>RSVPs with plus-ones.</strong> Response options are
            customizable — the defaults are{" "}
            <Term>Going 👍</Term> / <Term>Maybe 🤔</Term> /{" "}
            <Term>Can't Go 😢</Term>, and you can hide <Term>Maybe</Term>.
            Guests can add plus-ones with <Term>Bringing guests</Term>, so you
            get a real headcount. You can also hide the RSVP count from
            attendees while leaders still see it.
          </Step>
          <Step n={3}>
            <strong>Text blasts.</strong> Message everyone who's going or
            interested by SMS in one shot — the same message also posts to the
            event's activity feed.
          </Step>
          <Step n={4}>
            <strong>Event chat.</strong> Flip on an optional chat scoped to just
            this event. Only people who've RSVP'd can read or post in it.
          </Step>
          <Step n={5}>
            <strong>Visibility.</strong> Choose <Term>Group Only</Term>,{" "}
            <Term>Specific Groups</Term>, <Term>Community</Term>, or{" "}
            <Term>Public</Term>. <Term>Specific Groups</Term> lets you pick a
            handful of groups whose members can see and RSVP alongside the
            hosting group — handy for an event aimed at a few teams (say, a
            leaders' dinner across several locations) without opening it to the
            whole community. Public means anyone with the link can view the
            event; RSVPing still requires login.
          </Step>
          <Step n={6}>
            <strong>Check-in at the door.</strong> On the day, open the event
            and tap <Term>Check in</Term> to run down the <Term>Going</Term>{" "}
            list, tapping each person — and each guest they brought — as they
            arrive. Added names count as <Term>Present</Term> in your attendance
            numbers, and walk-ins without an account can be added by name. You
            can search the list by name instead of scrolling it. Once the event
            has wrapped,
            that same button becomes <Term>Take attendance</Term> and opens the
            full attendance editor for after-the-fact corrections. See{" "}
            <em>Check in: take attendance at the door</em> below.
          </Step>
        </Steps>

        <Callout tone="note" title="Reminders: which channel?">
          <p>
            <strong>SMS</strong> goes out for invites, manual re-invites, and
            text blasts — moments you trigger by hand. <strong>Automatic</strong>{" "}
            reminders as an event approaches are <em>push</em> notifications, not
            texts. Togather won't auto-text your group.
          </p>
        </Callout>
      </Section>

      <Section id="create" title="Creating an event">
        <P>
          Open the <Term>Create Event</Term> form, pick the hosting group, and
          fill in as much or as little as you like. Title is optional — leave it
          blank and Togather uses the group type as the title. Everything else
          lives on one scrollable form: date and time, poster, location or
          online toggle, description, hosts, RSVP options, and visibility.
        </P>

        <Figure caption="A representative slice of the Create Event form. Every label shown here is the real one.">
          {/* swap-in: <img src="/images/guides/events-create.png" /> */}
          <CreateEventMock />
        </Figure>
      </Section>

      <Section id="card" title="The event card">
        <P>
          Once posted, the event shows up as a card in the events feed: a cover
          image with the date badged in your community's color, the hosting
          group, the title, time, location, and a live row of who's going. Tap
          it to RSVP, bring guests, or jump into the event chat.
        </P>

        <Figure caption="An event card as members see it in the feed.">
          {/* swap-in: <img src="/images/guides/events-card.png" /> */}
          <EventCardMock />
        </Figure>
      </Section>

      <Section id="checkin" title="Check in: take attendance at the door">
        <P>
          When it's time to gather, you don't want to hunt through a
          group-by-group attendance grid — you want the door list for{" "}
          <em>this</em> event. Open the event and tap <Term>Check in</Term>{" "}
          (the button sits with the other manager actions and only shows for
          people who can manage the event). You'll see everyone who RSVP'd{" "}
          <Term>Going</Term> — along with any guests they said they were
          bringing — each with a tap-to-check circle, plus a live{" "}
          <Term>N / M checked in</Term> count, <Term>Add walk-in</Term>, and a
          search box pinned at the top. After the event has passed, the same
          button reads <Term>Take attendance</Term> and opens the full
          attendance editor instead.
        </P>

        <Steps>
          <Step n={1}>
            <strong>Tap to check in.</strong> Tapping a person marks them{" "}
            <Term>Present</Term> and stamps the time; tapping again undoes it.
            Every change saves immediately, so a second leader checking people
            in on their own phone sees the same list update live.
          </Step>
          <Step n={2}>
            <strong>Search for a name.</strong> A big event is a long list, so
            the <Term>Search by name</Term> box at the top filters the roster as
            you type — first name, last name, or both. Guest names are searched
            too, so looking up a guest surfaces the member who brought them.
            The <Term>N / M checked in</Term> count always covers the whole
            event, not just what the search is showing.
          </Step>
          <Step n={3}>
            <strong>Their guests.</strong> When someone RSVP'd{" "}
            <Term>Going</Term> with plus-ones, those show up as their own rows
            tucked under that person — <Term>Guest 1 of 2</Term>,{" "}
            <Term>Guest 2 of 2</Term> — each with its own check circle, so you
            count who actually walked in rather than assuming the whole party
            came. Checking a guest in opens a quick <Term>Guest name</Term>{" "}
            sheet: type the name if you have it, or tap <Term>Skip for now</Term>{" "}
            and add it later by tapping the row. Someone brought a friend they
            never RSVP'd for? <Term>Add guest</Term> under the member adds an
            extra one.
          </Step>
          <Step n={4}>
            <strong>Walk-ins.</strong> Someone showed up who didn't RSVP — or
            doesn't have a Togather account? Tap <Term>Add walk-in</Term> at the
            top of the screen, enter a first name (last name and phone are
            optional), and they're added already checked in. Added by mistake?
            Remove them with the trash icon.
          </Step>
          <Step n={5}>
            <strong>Running check-in from a laptop.</strong> Check-in works in
            the browser as well as the app. On a wide screen the roster splits
            into two or three columns and the controls move onto one row, so a
            big door list fits on screen instead of scrolling — handy when
            someone's running the welcome desk from a laptop.
          </Step>
          <Step n={6}>
            <strong>It feeds your numbers.</strong> A check-in is the same{" "}
            <Term>Present</Term> record the app already uses, so attendance and
            member-health stats stay correct — you're not tracking it twice.
            Declared plus-ones count toward the expected headcount from the
            start, so <Term>N / M</Term> tells you how much of the room you're
            still waiting on.
          </Step>
        </Steps>

        <Callout tone="note" title="Who can check people in">
          <p>
            Check-in is for people who manage the event — the event's hosts, the
            group's leaders, or a community admin. Regular attendees never see
            the <Term>Check in</Term> button, and the actions are enforced on
            the server, not just hidden.
          </p>
        </Callout>

        <Figure caption="The Check-in screen: a live checked-in count, Add walk-in and search pinned at the top, then the Going list with tap-to-check circles and each person's guests nested underneath. Rendered mock — labels match the real screen.">
          {/* swap-in: <img src="/images/guides/events-checkin.png" /> */}
          <CheckInMock />
        </Figure>
      </Section>

      <Section id="series" title="Series: bundle the dates">
        <P>
          A series is a <strong>named bundle of dates</strong>, not a recurrence
          rule — you pick exactly which dates you want rather than describing a
          "every other Tuesday" pattern. Flip{" "}
          <Term>Create / Add to Series</Term> on the event form, tap the dates
          you want on the calendar, pick one <Term>Time</Term> for all of them,
          and give it a <Term>Series Name</Term> like{" "}
          <Term>Weekly Dinner Party</Term>. Togather creates one event per date,
          all linked together.
        </P>

        <Callout tone="tip">
          Editing or cancelling later asks for scope: <Term>this event only</Term>{" "}
          or <Term>all in series</Term>. Move one week's dinner without touching
          the rest, or push the whole run at once.
        </Callout>
      </Section>

      <Section id="cwe" title="Community-wide events">
        <P>
          Sometimes you want every group of a kind to gather — a shared study, a
          prayer night, a serve day. As an admin, create one event scoped to a{" "}
          <Term>group type</Term> (the form shows{" "}
          <Term>{`{N} groups`}</Term> so you know the reach), and Togather gives{" "}
          <em>each group its own linked copy</em> of the event.
        </P>
        <P>
          It's uniform by default but flexible per group. A group's leader can
          edit their copy — which <strong>disconnects it</strong> from future
          parent updates — or cancel just theirs, without touching anyone else's.
          You manage all of them from the{" "}
          <Term>Community-Wide Events</Term> admin screen, which flags any copy a
          leader has customized.
        </P>

        <Figure caption="The Community-Wide Events admin screen, showing reach and any leader overrides.">
          {/* swap-in: <img src="/images/guides/events-community-wide.png" /> */}
          <CommunityWideEventMock />
        </Figure>

        <P>
          Ready to schedule one? This opens your own live community, signed in
          as you.
        </P>
        <DeepLink href={appLinks.communityWideEvents}>
          Open community-wide events
        </DeepLink>
      </Section>

      <Section id="combo" title="The power combo">
        <P>
          Community-wide and series stack. Want{" "}
          <em>"all Small Groups meet every Wednesday at 7 for the rest of the
          semester"</em>? Pick the dates once and pick the group type once.
        </P>

        <Callout tone="tip" title="One form, dozens of events">
          <p>
            Select your dates, select your group type, and the form previews the
            whole rollout before you commit —{" "}
            <Term>3 dates · 12 groups · 36 events total</Term>. Tap once and
            Togather creates the event in every small group, for every date.
          </p>
        </Callout>
      </Section>
    </GuideLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Page-local UI mockups                                              */
/* ------------------------------------------------------------------ */

/** A small UI label / field heading used inside the mock forms. */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[11px] font-semibold text-neutral-500">
      {children}
    </div>
  );
}

/** A pill toggle (on state) used inside the mock forms. */
function ToggleOn() {
  return (
    <span className="flex h-5 w-9 flex-shrink-0 items-center rounded-full bg-primary-600 px-0.5">
      <span className="ml-auto h-4 w-4 rounded-full bg-white" />
    </span>
  );
}

/**
 * Check-in screen — mirrors the real screen: the pinned controls (summary card
 * with the live "N / M checked in" count and progress bar, the dashed "Add
 * walk-in" button, and the search box), then the Going list with tap-to-check
 * circles (filled green = checked in, empty = not yet), each member's guest
 * slots nested underneath, and the Walk-ins section.
 */
function CheckInMock() {
  const going = [
    {
      name: "Gina Going",
      initials: "GG",
      color: "bg-primary-400",
      checkedIn: true,
      time: "6:58 PM",
      // Gina RSVP'd with two plus-ones; one is in and named, one hasn't arrived.
      guests: [
        { label: "Ada Lovelace", checkedIn: true, sub: "Checked in · 7:00 PM" },
        { label: "Guest 2 of 2", checkedIn: false, sub: "Tap to check in" },
      ],
    },
    {
      name: "Mel Member",
      initials: "MM",
      color: "bg-accent-500",
      checkedIn: true,
      time: "7:01 PM",
      guests: [
        { label: "Guest", checkedIn: true, sub: "Checked in · tap to add name" },
      ],
    },
    {
      name: "Sam Rivera",
      initials: "SR",
      color: "bg-amber-500",
      checkedIn: false,
      time: null,
      guests: [],
    },
  ];
  return (
    <PhoneFrame title="Check in">
      <div className="bg-neutral-50 p-3">
        {/* Pinned controls: summary, Add walk-in, search. */}
        <div className="rounded-xl bg-white p-3.5 shadow-sm">
          <div className="text-[17px] font-bold text-neutral-900">
            5 / 7 checked in
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
            <div className="h-2 rounded-full bg-emerald-500" style={{ width: "71%" }} />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary-400 py-2.5 text-[14px] font-semibold text-primary-600">
          <span className="text-[16px] leading-none">＋</span> Add walk-in
        </div>

        <div className="mt-3 flex items-center gap-2 rounded-xl border-2 border-neutral-200 bg-neutral-100 px-3 py-2.5">
          <span className="text-[13px] leading-none text-neutral-400">🔍</span>
          <span className="text-[13px] text-neutral-400">Search by name</span>
        </div>

        {/* Going list. */}
        <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Going (3)
        </div>
        <div className="mt-2 space-y-2">
          {going.map((p) => (
            <div key={p.name}>
              <div className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm">
                <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${p.color} text-[11px] font-semibold text-white`}>
                  {p.initials}
                </span>
                <div className="flex-1">
                  <div className="text-[14px] font-semibold text-neutral-900">{p.name}</div>
                  <div className={`text-[12px] ${p.checkedIn ? "text-emerald-600" : "text-neutral-500"}`}>
                    {p.checkedIn ? `Checked in · ${p.time}` : "Tap to check in"}
                  </div>
                </div>
                {p.checkedIn ? (
                  <span className="text-[22px] leading-none text-emerald-500">✅</span>
                ) : (
                  <span className="inline-block h-[22px] w-[22px] rounded-full border-2 border-neutral-300" />
                )}
              </div>

              {/* Their guests, indented under them. */}
              {p.guests.map((g) => (
                <div key={g.label} className="mt-1 flex items-center pl-6">
                  <span className="h-px w-3 bg-neutral-200" />
                  <div className="flex flex-1 items-center gap-2.5 rounded-lg bg-white px-3 py-2 shadow-sm">
                    <span className="text-[13px] leading-none text-neutral-400">👤</span>
                    <div className="flex-1">
                      <div className="text-[13px] font-medium text-neutral-900">{g.label}</div>
                      <div className={`text-[11px] ${g.checkedIn ? "text-emerald-600" : "text-neutral-500"}`}>
                        {g.sub}
                      </div>
                    </div>
                    {g.checkedIn ? (
                      <span className="text-[18px] leading-none text-emerald-500">✅</span>
                    ) : (
                      <span className="inline-block h-[18px] w-[18px] rounded-full border-2 border-neutral-300" />
                    )}
                  </div>
                </div>
              ))}

              {/* Undeclared extra, offered once the member is in. */}
              {p.checkedIn && (
                <div className="mt-1.5 flex items-center gap-1 pl-9 text-[12px] font-semibold text-primary-600">
                  <span className="text-[13px] leading-none">＋</span> Add guest
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Walk-ins. */}
        <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Walk-ins (1)
        </div>
        <div className="mt-2 flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-neutral-400 text-[11px] font-semibold text-white">
            JT
          </span>
          <div className="flex-1">
            <div className="text-[14px] font-semibold text-neutral-900">Jo Tan</div>
            <div className="text-[12px] text-emerald-600">Checked in · 7:03 PM</div>
          </div>
          <span className="text-[16px] leading-none text-neutral-400">🗑️</span>
        </div>
      </div>
    </PhoneFrame>
  );
}

/**
 * (a) Event card — matches the real feed card:
 * full-width cover with a date badge overlaid top-left, hosting group row,
 * title, date line, location line, then the RSVP row above a hairline divider.
 */
function EventCardMock() {
  const guests = [
    { label: "JD", color: "bg-primary-400" },
    { label: "MK", color: "bg-accent-500" },
    { label: "RS", color: "bg-amber-500" },
  ];
  return (
    <PhoneFrame title="Events">
      <div className="bg-neutral-50 p-3">
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {/* Cover with date badge overlaid top-left. */}
          <div className="relative flex h-[140px] items-center justify-center bg-gradient-to-br from-primary-300 to-primary-500 text-3xl">
            🍽️
            <div className="absolute left-3 top-3 rounded-xl bg-white px-2.5 py-1 text-center shadow-sm">
              <div className="text-[10px] font-bold uppercase leading-none text-primary-600">
                Jun
              </div>
              <div className="text-base font-bold leading-tight text-neutral-900">
                12
              </div>
            </div>
          </div>

          <div className="p-3.5">
            {/* Hosting group row. */}
            <div className="flex items-center gap-2">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary-100 text-[9px] font-semibold text-primary-700">
                MG
              </span>
              <span className="text-[12px] text-neutral-500">Men's Group</span>
            </div>

            {/* Title. */}
            <div className="mt-1.5 text-[17px] font-semibold leading-snug text-neutral-900">
              Tuesday Dinner &amp; Study
            </div>

            {/* Date line. */}
            <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-neutral-600">
              <span className="text-neutral-400">📅</span>
              <span>Wed, Jun 12 · 7:00 PM</span>
            </div>
            {/* Location line. */}
            <div className="mt-1 flex items-center gap-1.5 text-[12px] text-neutral-600">
              <span className="text-neutral-400">📍</span>
              <span>114 Grace Ave · Apt 3</span>
            </div>

            {/* RSVP row above a hairline divider. */}
            <div className="mt-3 flex items-center gap-2 border-t border-neutral-100 pt-3">
              <div className="flex -space-x-2">
                {guests.map((g) => (
                  <span
                    key={g.label}
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${g.color} text-[9px] font-semibold text-white ring-2 ring-white`}
                  >
                    {g.label}
                  </span>
                ))}
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-neutral-200 text-[9px] font-semibold text-neutral-600 ring-2 ring-white">
                  +9
                </span>
              </div>
              <span className="text-[12px] font-medium text-neutral-600">
                12 people going
              </span>
            </div>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

/**
 * (b) Create Event form — a representative subset of the real form:
 * Hosting Group, the Create / Add to Series switch with its helper, Title with
 * helper, the poster slot, RSVP Options (toggle + three editable rows + Hide
 * RSVP count), and the Create Event button. Every label is the real one.
 */
function CreateEventMock() {
  const rsvpRows = ["Going 👍", "Maybe 🤔", "Can't Go 😢"];
  return (
    <PhoneFrame title="Create Event">
      {/* Drag handle. */}
      <div className="flex justify-center pt-1.5">
        <span className="h-1 w-9 rounded-full bg-neutral-300" />
      </div>

      <div className="space-y-3.5 bg-white p-3">
        {/* Hosting Group. */}
        <div>
          <FieldLabel>Hosting Group *</FieldLabel>
          <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm">
            <span className="text-neutral-900">Men's Group</span>
            <span className="text-neutral-400">▾</span>
          </div>
        </div>

        {/* Create / Add to Series switch. */}
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-neutral-900">
              Create / Add to Series
            </div>
            <ToggleOn />
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">
            Select multiple dates to create linked events
          </div>
        </div>

        {/* Title. */}
        <div>
          <FieldLabel>Title</FieldLabel>
          <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800">
            Tuesday Dinner &amp; Study
          </div>
          <div className="mt-1 text-[11px] text-neutral-400">
            Leave blank to use "Men's Group" as the title
          </div>
        </div>

        {/* Poster slot. */}
        <div>
          <FieldLabel>Poster</FieldLabel>
          <div className="flex aspect-square w-full items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 text-[12px] font-medium text-neutral-400">
            Tap to choose a poster
          </div>
        </div>

        {/* RSVP Options. */}
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-neutral-900">
              Enable RSVPs
            </div>
            <ToggleOn />
          </div>
          <div className="mt-2.5 space-y-1.5">
            {rsvpRows.map((row) => (
              <div
                key={row}
                className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[12px] text-neutral-800"
              >
                {row}
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex items-center justify-between">
            <div className="text-[12px] font-medium text-neutral-700">
              Hide RSVP count
            </div>
            <span className="flex h-5 w-9 flex-shrink-0 items-center rounded-full bg-neutral-200 px-0.5">
              <span className="h-4 w-4 rounded-full bg-white" />
            </span>
          </div>
        </div>

        <button className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white">
          Create Event
        </button>
      </div>
    </PhoneFrame>
  );
}

/**
 * (c) Community-Wide Events admin screen — header + event cards with a
 * "Scheduled" status badge, date line, group-type and group-count rows (with an
 * italic orange override note), and outlined Edit / red Cancel actions.
 */
function CommunityWideEventMock() {
  return (
    <PhoneFrame title="Community-Wide Events">
      <div className="bg-neutral-50 p-3">
        <div className="mb-3 px-0.5">
          <div className="text-[15px] font-bold text-neutral-900">
            Community-Wide Events
          </div>
          <div className="text-[11px] text-neutral-500">2 upcoming, 5 past</div>
        </div>

        <div className="space-y-2.5">
          {/* Card 1 — with overrides. */}
          <div className="rounded-2xl bg-white p-3.5 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="text-[15px] font-semibold leading-snug text-neutral-900">
                Wednesday Study Night
              </div>
              <span className="flex-shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                Scheduled
              </span>
            </div>

            <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-neutral-600">
              <span className="text-neutral-400">📅</span>
              <span>Wed, Jun 18 · 7:00 PM</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[12px] text-neutral-600">
              <span className="text-neutral-400">🗂️</span>
              <span>Small Groups</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[12px] text-neutral-600">
              <span className="text-neutral-400">👥</span>
              <span>12 groups</span>
              <span className="italic text-orange-500">(2 overridden)</span>
            </div>

            <div className="mt-3 flex gap-2">
              <span className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-center text-[12px] font-medium text-neutral-700">
                Edit
              </span>
              <span className="flex-1 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-center text-[12px] font-medium text-red-600">
                Cancel
              </span>
            </div>
          </div>

          {/* Card 2 — no overrides. */}
          <div className="rounded-2xl bg-white p-3.5 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="text-[15px] font-semibold leading-snug text-neutral-900">
                Community Serve Day
              </div>
              <span className="flex-shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                Scheduled
              </span>
            </div>

            <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-neutral-600">
              <span className="text-neutral-400">📅</span>
              <span>Sat, Jun 21 · 9:00 AM</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[12px] text-neutral-600">
              <span className="text-neutral-400">🗂️</span>
              <span>Ministry Teams</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[12px] text-neutral-600">
              <span className="text-neutral-400">👥</span>
              <span>8 groups</span>
            </div>

            <div className="mt-3 flex gap-2">
              <span className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-center text-[12px] font-medium text-neutral-700">
                Edit
              </span>
              <span className="flex-1 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-center text-[12px] font-medium text-red-600">
                Cancel
              </span>
            </div>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}
