import { Fragment } from "react";
import { GuideLayout, type TocItem } from "../../components/guide/GuideLayout";
import {
  Lead,
  Section,
  P,
  Callout,
  Steps,
  Step,
  Term,
  Figure,
} from "../../components/guide/primitives";
import { PhoneFrame } from "../../components/guide/PhoneFrame";
import { DesktopFrame } from "../../components/guide/DesktopFrame";

const toc: TocItem[] = [
  { id: "what", label: "What event plans are" },
  { id: "finding", label: "Finding Rostering" },
  { id: "tabs", label: "The three tabs" },
  { id: "teams", label: "Teams & roles" },
  { id: "plans", label: "Building an event plan" },
  { id: "publishing", label: "Publishing & reminders" },
  { id: "availability", label: "Availability" },
  { id: "grid", label: "The roster grid" },
  { id: "crossteam", label: "Cross-team channels" },
  { id: "runsheet", label: "Run sheets" },
];

/**
 * Guide post: "Event plans: teams, rostering & run sheets."
 *
 * Togather's answer to Planning Center Services. Reconstructs the rostering UI
 * as code mockups — finding Rostering from a group, the three tabs, team setup,
 * a published plan card, the availability chat card, the desktop roster grid,
 * cross-team channels, and the run sheet. Every label is kept in sync with the
 * real mobile rostering feature (apps/mobile features/scheduling +
 * features/chat + features/leader-tools). The guide uses static mockups rather
 * than live demos.
 */
export function EventPlans() {
  return (
    <GuideLayout slug="event-plans" toc={toc}>
      <Lead>
        This is Togather's answer to Planning Center Services. Any group can plan
        its events: define the serving teams, collect availability, roster
        volunteers into the slots you need, and run the day itself from a shared
        run sheet. It all lives at the group level, so the same flow works for a
        worship team, a whole campus, or a single small group.
      </Lead>

      <Section id="what" title="What event plans are">
        <P>
          An event plan is everything you need to staff and run a gathering: who
          serves, in which roles, at which service times, and the order of
          service for the day. Rostering is a tab inside any group, with three
          views — <Term>Schedule</Term>, <Term>Teams</Term>, and{" "}
          <Term>Cross-team</Term> — so a leader can move between building teams,
          filling plans, and seeing where people overlap.
        </P>
        <Callout tone="note">
          Because rostering is scoped to the group, you don't need a separate
          tool for your worship team and your hospitality team. Each group runs
          its own plans, and people who serve on more than one show up across
          them.
        </Callout>
      </Section>

      <Section id="finding" title="Finding Rostering">
        <P>
          Rostering lives inside each group, so there's no shareable link
          straight to it — you open the group first. There's no gear or
          ellipsis menu either. Open the group, scroll to the{" "}
          <Term>GROUP ACTIONS</Term> section near the bottom, and tap{" "}
          <Term>Rostering</Term>.
        </P>

        <Steps>
          <Step n={1}>
            Open the group you want to plan for (for example a campus group like{" "}
            <Term>Queens Campus</Term>).
          </Step>
          <Step n={2}>
            Scroll down past <Term>MEMBERS</Term> and <Term>CHANNELS</Term> to
            the <Term>GROUP ACTIONS</Term> section.
          </Step>
          <Step n={3}>
            Tap <Term>Rostering</Term> (the calendar row). That drops you into
            the rostering tabs for this group.
          </Step>
        </Steps>

        <Figure caption="Open the group → scroll to GROUP ACTIONS → tap Rostering. That lands you on the Schedule tab.">
          <FindRosteringMock />
        </Figure>
      </Section>

      <Section id="tabs" title="The three tabs">
        <P>
          Rostering opens to a top tab bar with three views. The active tab is
          tinted in your community color with a short underline.
        </P>
        <Steps>
          <Step n={1}>
            <Term>Schedule</Term> — create and publish event plans, share the
            availability link, and open the roster grid. This is where day-to-day
            scheduling happens.
          </Step>
          <Step n={2}>
            <Term>Teams</Term> — define the serving teams and their roles once.
            Every event plan draws from these.
          </Step>
          <Step n={3}>
            <Term>Cross-team</Term> — channels that auto-sync a group chat from
            people's roles across teams (and across campuses). Covered in detail{" "}
            <a href="#crossteam" className="text-primary-700 underline">
              below
            </a>
            .
          </Step>
        </Steps>
      </Section>

      <Section id="teams" title="Teams & roles">
        <P>
          On the <Term>Teams</Term> tab, leaders create the teams that do the
          serving — <Term>Worship</Term>, <Term>Hospitality</Term>,{" "}
          <Term>Communion Prep</Term>, whatever your church runs. A team takes a{" "}
          <Term>Team name</Term> and an optional description, and you can flip on{" "}
          <Term>Give this team a chat channel</Term> so the team gets its own
          chat to coordinate.
        </P>
        <P>
          Each team defines its own free-form roles. Tap <Term>Add role</Term>,
          give it a name like <Term>Drums</Term>, pick a color, and set{" "}
          <Term>Usually need</Term> — the default number of slots that role
          fills on a normal week. To save you typing, the app even suggests roles
          based on the team's name.
        </P>

        <Figure caption="A serving team and its roles, defined once on the Teams tab.">
          <TeamSetupMock />
        </Figure>
      </Section>

      <Section id="plans" title="Building an event plan">
        <P>
          On the <Term>Schedule</Term> tab, tap <Term>New event plan</Term> (the
          dashed row) to start a draft — it defaults to next Sunday at 9:00 AM. A
          plan has a date and one or more <Term>service times</Term> (say 9:00 AM
          and 11:00 AM), and the needed roles per team via{" "}
          <Term>Set needed roles</Term>. Everything auto-saves as you go.
        </P>
        <P>
          A plan starts as a <Term>Draft</Term>. Each plan card shows a
          fill-progress bar reading{" "}
          <Term>{"{filled}/{needed} filled"}</Term> with a{" "}
          <Term>{"{n} confirmed"}</Term> sub-line, so you can see at a glance
          which days still need people. Publishing is what notifies everyone —
          covered next.
        </P>

        <Figure caption="A published plan card with its fill-progress bar, on the Schedule tab.">
          <PlanCardMock />
        </Figure>
      </Section>

      <Section id="publishing" title="Publishing & reminders">
        <P>
          Building a plan doesn't tell anyone yet — <strong>publishing</strong>{" "}
          is the moment volunteers hear from you. When a leader taps{" "}
          <Term>Publish &amp; send requests</Term> at the bottom of the plan
          editor, everyone rostered into that plan gets both a push notification{" "}
          <em>and</em> a text letting them know they're on the schedule to serve
          for that day, and asking them to confirm or decline.
        </P>

        <Callout tone="tip" title="Publishing is what notifies people">
          <p>
            On publish, every rostered volunteer gets a push{" "}
            <strong>and</strong> an SMS: you're on the schedule to serve for this
            day — please confirm or decline. Anyone who hasn't responded gets
            follow-up reminders to confirm or decline.
          </p>
          <p>
            If you change the plan and publish again, the bottom bar reads{" "}
            <Term>Re-send requests</Term> instead.
          </p>
        </Callout>

        <Figure caption="The plan editor's bottom bar sends the requests; volunteers confirm or decline from the push/SMS.">
          <PublishBarMock />
        </Figure>
      </Section>

      <Section id="availability" title="Availability">
        <P>
          Availability tells leaders who they can <em>draw from</em> before they
          build a plan — it's not the same as being scheduled. Members can set it
          two ways: from <Term>My Availability</Term> in the app, or from a
          public link a leader shares.
        </P>

        <P>
          The link lives on the <Term>Schedule</Term> tab as{" "}
          <Term>Share availability link</Term> (the share-outline row). Tapping
          it generates a public link (<Term>togather.nyc/a/…</Term>) and opens
          the share sheet with the message{" "}
          <Term>Let us know when you can serve: {"{link}"}</Term>. The link asks
          for availability across <em>all</em> upcoming event plans at once.
        </P>

        <Callout tone="tip" title="Drop the link right into a chat">
          Paste that availability link into any Togather channel or group and it
          renders as a native availability card — members tap each date inline,
          right in the conversation, without leaving the chat. It's perfect in a
          team channel or a whole-team group.
        </Callout>

        <Figure caption="The availability link posted into a team channel renders as a native card — members tap Available / Can't per date.">
          <AvailabilityCardMock />
        </Figure>

        <P>
          Inside the app, members open <Term>My Availability</Term> and mark
          each upcoming plan <Term>Available</Term> or{" "}
          <Term>Can't make it</Term>. Either path feeds the same place: the
          editor shows who's available, can't, or hasn't responded for each
          plan.
        </P>

        <Figure caption="My Availability — members mark each upcoming plan in the app.">
          <AvailabilityMock />
        </Figure>

        <P>
          For people who haven't installed the app, the public{" "}
          <Term>/a/</Term> page works on its own. The recipient taps{" "}
          <Term>Available</Term> or <Term>Can't make it</Term> per date, then{" "}
          <Term>Save availability</Term> if they're signed in, or{" "}
          <Term>Continue</Term> to verify by phone. Their answers match back to
          their Togather account either way.
        </P>
      </Section>

      <Section id="grid" title="The roster grid">
        <P>
          The roster grid is the heart of rostering, and it shines on a big
          screen. Roles run down the left, grouped by team; each event plan is a
          column; and every cell shows who's filling that role for that day —
          confirmed, awaiting, or declined — plus any open slots still to fill.
        </P>

        <P>
          You open it from <Term>Schedule</Term> →{" "}
          <Term>Roster grid</Term> (the git-network-outline row). Like the rest
          of rostering it's group-dependent, so there's no shareable deep link —
          you open it inside each group.
        </P>

        <Figure caption="The roster grid — roles down the side, plans across the top.">
          <RosterGridMock />
        </Figure>

        <P>
          Confirmed cells tint light green and awaiting cells tint light amber,
          so a fully-staffed week reads as a wall of green and the gaps jump out.
          A segmented <Term>Roles</Term> / <Term>People</Term> control flips the
          grid to a per-person view when you'd rather see one volunteer's whole
          schedule.
        </P>
      </Section>

      <Section id="crossteam" title="Cross-team channels">
        <P>
          A cross-team channel is a group chat whose membership is driven by{" "}
          <strong>who's rostered for which roles</strong> — not a fixed list of
          people. It auto-syncs members from chosen roles across multiple teams,
          and across <em>groups and campuses</em> in the same community. As
          people get rostered and un-rostered each week, the channel's membership
          updates itself.
        </P>
        <P>Two ways churches use it:</P>
        <Steps>
          <Step n={1}>
            A <Term>Sunday Leads</Term> channel that always contains whoever is
            rostered as production lead, worship lead, and preacher this week — so
            the people actually running Sunday are always together, even as those
            people change.
          </Step>
          <Step n={2}>
            A cross-campus <Term>Broadcast</Term> channel that syncs every
            campus's broadcast and service directors into one place, so they can
            coordinate timing during a live broadcast.
          </Step>
        </Steps>

        <P>
          You create one from the <Term>Cross-team</Term> tab via{" "}
          <Term>New cross-team channel</Term>. On the Create Channel screen, the{" "}
          <Term>Channel Type</Term> control offers <Term>Custom</Term>,{" "}
          <Term>Planning Center</Term>, and{" "}
          <Term>Cross-team channel</Term>. Pick the last one and you get the hint{" "}
          <Term>
            Auto-syncs members rostered for chosen roles across multiple teams.
          </Term>{" "}
          followed by a two-step <Term>Synced roles *</Term> picker.
        </P>

        <Figure caption="Cross-team picker: choose which groups to draw from (step 1), then expand each team and pick roles (step 2). This is how cross-campus works.">
          <CrossTeamPickerMock />
        </Figure>

        <P>
          Step 1, <Term>Choose groups to draw from</Term>, lists every group in
          the community that has a serving team — checking more than one is what
          makes a channel cross-campus. Step 2,{" "}
          <Term>Choose roles</Term>, expands each team so you can pick{" "}
          <Term>Any role on this team</Term> or specific roles. Each choice shows
          as a chip in the form <Term>{"{team} — {role}"}</Term>. Then you set a{" "}
          <Term>Channel Name *</Term> (it can't be changed later) and you're done.
        </P>

        <Figure caption="A resulting cross-team channel card on the Cross-team tab — membership follows the synced roles.">
          <CrossTeamCardMock />
        </Figure>

        <Callout tone="note">
          Before any of this works, at least one group in the community needs a
          serving team with roles. The empty <Term>Cross-team</Term> tab spells
          it out: a cross-team channel auto-syncs members rostered for chosen
          roles across several teams.
        </Callout>
      </Section>

      <Section id="runsheet" title="Run sheets">
        <P>
          Every plan also gets one shared run sheet — the order of service for
          the day. It's a spreadsheet-style editor: each row carries a duration
          (in <Term>m:ss</Term>), and the clock time on the left{" "}
          <strong>cascades automatically</strong> from the earliest service start
          down through each item. Items are grouped into{" "}
          <Term>Before event</Term>, <Term>During event</Term>, and{" "}
          <Term>After event</Term> segments, and you drag the grip to reorder.
        </P>
        <P>
          A row can be a plain item, a <Term>Header</Term>, or a{" "}
          <Term>Song</Term> (with per-service <Term>Key</Term> and{" "}
          <Term>BPM</Term>). Rows can link a role — a colored chip{" "}
          <Term>{"{role}: {names}"}</Term> that resolves to whoever currently
          fills it — and carry notes. At the bottom, an <Term>Add to:</Term>{" "}
          chooser (Before / During / After) sets where new rows land, then{" "}
          <Term>Add item</Term>, <Term>Song</Term>, and <Term>Header</Term> add
          them. Rows can be duplicated or deleted.
        </P>

        <Figure caption="The run sheet — segmented order of service with cascading clock times, song Key/BPM, and a role chip.">
          <RunSheetMock />
        </Figure>

        <P>
          <strong>Surfacing it to the whole group.</strong> By default the run
          sheet is a leader tool, but you can let every member pull up the order
          of service. A leader opens{" "}
          <Term>GROUP ACTIONS → Toolbar Settings</Term>, enables the{" "}
          <Term>Run Sheet</Term> tool, turns on{" "}
          <Term>Show toolbar to members</Term>, and sets the Run Sheet tool's
          visibility to <Term>Everyone</Term>. Members then see a read-only run
          sheet in the group toolbar.
        </P>

        <Figure caption="Toolbar Settings — flip Run Sheet on, show the toolbar to members, and set its visibility to Everyone.">
          <ToolbarSettingsMock />
        </Figure>

        <P>
          <strong>Two sources.</strong> In Run Sheet settings there's a{" "}
          <Term>Run Sheet Source</Term> toggle. Pick <Term>Togather</Term> —{" "}
          <em>built and edited natively in the app, per event plan</em> — or{" "}
          <Term>Planning Center</Term> — <em>pulled live from your Planning
          Center service plans</em>. So a church already on PCO can surface its
          existing service plans, while everyone else builds run sheets natively
          in Togather.
        </P>
      </Section>
    </GuideLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Shared mock helpers                                                */
/* ------------------------------------------------------------------ */

/** A tiny inline Ionicons-style glyph, rendered as a label chip placeholder. */
function Ion({
  name,
  className = "text-neutral-500",
  size = 16,
}: {
  name: string;
  className?: string;
  size?: number;
}) {
  // Lightweight SVG stand-ins for the few Ionicons we reference in mocks.
  // Keeps the guide dependency-free while reading as the real icon.
  const stroke = "currentColor";
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: `flex-shrink-0 ${className}`,
  };
  switch (name) {
    case "calendar-outline":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      );
    case "pin-outline":
      return (
        <svg {...common}>
          <path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z" />
          <circle cx="12" cy="9" r="2.5" />
        </svg>
      );
    case "options-outline":
      return (
        <svg {...common}>
          <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4" />
          <circle cx="16" cy="6" r="2" />
          <circle cx="8" cy="12" r="2" />
          <circle cx="14" cy="18" r="2" />
        </svg>
      );
    case "create-outline":
      return (
        <svg {...common}>
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
        </svg>
      );
    case "share-outline":
      return (
        <svg {...common}>
          <path d="M12 16V4M8 8l4-4 4 4" />
          <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
        </svg>
      );
    case "git-network-outline":
      return (
        <svg {...common}>
          <circle cx="12" cy="5" r="2.5" />
          <circle cx="6" cy="19" r="2.5" />
          <circle cx="18" cy="19" r="2.5" />
          <path d="M12 7.5V12M12 12H6v4.5M12 12h6v4.5" />
        </svg>
      );
    case "git-merge-outline":
      return (
        <svg {...common}>
          <circle cx="7" cy="6" r="2.5" />
          <circle cx="7" cy="18" r="2.5" />
          <circle cx="18" cy="12" r="2.5" />
          <path d="M7 8.5v7M7 11a7 7 0 0 0 7 7l1.5 0" />
        </svg>
      );
    case "people-outline":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20a6 6 0 0 1 12 0" />
          <path d="M16 5.5a3 3 0 0 1 0 5.5M17 14a6 6 0 0 1 4 6" />
        </svg>
      );
    case "sync-outline":
      return (
        <svg {...common}>
          <path d="M4 12a8 8 0 0 1 14-5M20 12a8 8 0 0 1-14 5" />
          <path d="M18 3v4h-4M6 21v-4h4" />
        </svg>
      );
    case "list-outline":
      return (
        <svg {...common}>
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      );
    case "link-outline":
      return (
        <svg {...common}>
          <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
          <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
        </svg>
      );
    case "reorder-three":
      return (
        <svg {...common}>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      );
    case "chevron-forward":
    default:
      return (
        <svg {...common}>
          <path d="M9 18l6-6-6-6" />
        </svg>
      );
  }
}

/* ------------------------------------------------------------------ */
/* Page-local UI mockups                                              */
/* ------------------------------------------------------------------ */

/** An icon + label + chevron action row, faithful to GroupDetailScreen. */
function ActionRow({
  icon,
  label,
  emphasized = false,
}: {
  icon: string;
  label: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
        emphasized
          ? "bg-primary-50 ring-1 ring-primary-300"
          : "bg-white border border-neutral-100"
      }`}
    >
      <Ion
        name={icon}
        className={emphasized ? "text-primary-700" : "text-neutral-600"}
        size={18}
      />
      <span
        className={`flex-1 text-[13px] font-medium ${
          emphasized ? "text-primary-800" : "text-neutral-800"
        }`}
      >
        {label}
      </span>
      <Ion name="chevron-forward" className="text-neutral-300" size={14} />
    </div>
  );
}

/** (1) Side-by-side: a group page → the Rostering screen. */
function FindRosteringMock() {
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-stretch sm:justify-center">
      {/* Phone A — group page */}
      <div className="w-full max-w-[260px]">
        <PhoneFrame title="Group" width={260}>
          <div className="bg-neutral-50 p-3">
            {/* Hero */}
            <div className="flex flex-col items-center pb-3">
              <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-primary-400 text-lg font-bold text-white">
                QC
              </div>
              <div className="mt-2 text-[17px] font-bold text-neutral-900">
                Queens Campus
              </div>
              <div className="text-[11px] font-medium text-neutral-500">
                Sundays · 9:00 &amp; 11:00 AM
              </div>
            </div>

            <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              MEMBERS · 240
            </div>
            <div className="mt-1 mb-3 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              CHANNELS
            </div>

            <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              GROUP ACTIONS
            </div>
            <div className="mt-1.5 space-y-1.5">
              <ActionRow icon="pin-outline" label="Pin Channels" />
              <ActionRow icon="options-outline" label="Toolbar Settings" />
              <ActionRow
                icon="calendar-outline"
                label="Rostering"
                emphasized
              />
              <ActionRow icon="create-outline" label="Edit Group" />
            </div>
          </div>
        </PhoneFrame>
      </div>

      {/* Arrow */}
      <div className="flex items-center justify-center text-2xl text-neutral-300 sm:flex-col">
        <span className="hidden sm:inline">→</span>
        <span className="sm:hidden">↓</span>
      </div>

      {/* Phone B — rostering schedule */}
      <div className="w-full max-w-[260px]">
        <PhoneFrame title="Rostering" width={260}>
          <div className="bg-white">
            {/* Tab bar */}
            <div className="flex border-b border-neutral-100 text-[12px] font-medium">
              <div className="relative flex-1 py-2 text-center font-bold text-primary-700">
                Schedule
                <span className="absolute bottom-0 left-1/2 h-[3px] w-[55%] -translate-x-1/2 rounded-full bg-primary-600" />
              </div>
              <div className="flex-1 py-2 text-center text-neutral-400">
                Teams
              </div>
              <div className="flex-1 py-2 text-center text-neutral-400">
                Cross-team
              </div>
            </div>

            <div className="space-y-2.5 bg-neutral-50 p-3">
              <button className="flex w-full items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-primary-400 py-2 text-[12px] font-semibold text-primary-700">
                <span className="text-base leading-none">+</span> New event plan
              </button>
              <div className="flex items-center justify-center gap-1.5 rounded-xl border border-neutral-200 bg-white py-2 text-[12px] font-medium text-neutral-600">
                <Ion name="share-outline" size={15} /> Share availability link
              </div>
              <div className="flex items-center justify-center gap-1.5 rounded-xl border border-neutral-200 bg-white py-2 text-[12px] font-medium text-neutral-600">
                <Ion name="git-network-outline" size={15} /> Roster grid
              </div>

              <div className="rounded-xl border border-neutral-200 bg-white p-3">
                <div className="text-[12px] font-semibold text-neutral-900">
                  Sunday Service
                </div>
                <div className="text-[10px] text-neutral-500">
                  Sun · Jun 15 · 9:00 AM
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                  <div className="h-full w-2/3 rounded-full bg-green-500" />
                </div>
                <div className="mt-1 text-[10px] text-neutral-500">
                  7/10 filled
                </div>
              </div>
            </div>
          </div>
        </PhoneFrame>
      </div>
    </div>
  );
}

/** (a) A team with its colored roles and "usually need" counts. */
function TeamSetupMock() {
  const roles = [
    { name: "Vocals", color: "bg-rose-500", need: 3 },
    { name: "Acoustic Guitar", color: "bg-amber-500", need: 1 },
    { name: "Drums", color: "bg-sky-500", need: 1 },
    { name: "Keys", color: "bg-violet-500", need: 1 },
  ];
  return (
    <PhoneFrame title="Teams">
      <div className="space-y-3 bg-neutral-50 p-3">
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <div className="text-sm font-semibold text-neutral-900">Worship</div>
          <div className="mt-0.5 text-[11px] text-neutral-500">
            Sunday morning worship team
          </div>
          <div className="mt-3 flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2">
            <span className="text-[11px] font-medium text-neutral-600">
              Give this team a chat channel
            </span>
            <span className="flex h-5 w-9 items-center rounded-full bg-primary-600 px-0.5">
              <span className="ml-auto h-4 w-4 rounded-full bg-white" />
            </span>
          </div>
        </div>

        <div className="space-y-2">
          {roles.map((r) => (
            <div
              key={r.name}
              className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3"
            >
              <span className={`h-3 w-3 flex-shrink-0 rounded-full ${r.color}`} />
              <div className="flex-1 text-sm font-medium text-neutral-900">
                {r.name}
              </div>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500">
                Usually need {r.need}
              </span>
            </div>
          ))}
          <button className="w-full rounded-xl border border-dashed border-primary-300 bg-primary-50/50 py-2.5 text-sm font-semibold text-primary-700">
            + Add role
          </button>
        </div>
      </div>
    </PhoneFrame>
  );
}

/** (b) A published plan card with its fill-progress bar. */
function PlanCardMock() {
  const filled = 7;
  const needed = 10;
  const pct = Math.round((filled / needed) * 100);
  return (
    <PhoneFrame title="Schedule">
      <div className="space-y-3 bg-neutral-50 p-3">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm font-semibold text-neutral-900">
                Sunday Service
              </div>
              <div className="mt-0.5 text-[11px] text-neutral-500">
                Sun · Jun 15 · 9:00 AM &amp; 11:00 AM
              </div>
            </div>
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">
              Published
            </span>
          </div>

          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-neutral-600">
              <span>
                {filled}/{needed} filled
              </span>
              <span>{filled} confirmed</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full rounded-full bg-green-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>

        <button className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white">
          + New event plan
        </button>
      </div>
    </PhoneFrame>
  );
}

/** Publish bar + a confirm/decline request, faithful to the plan editor. */
function PublishBarMock() {
  return (
    <PhoneFrame title="Sunday Service">
      <div className="flex h-full flex-col bg-neutral-50">
        <div className="flex-1 space-y-3 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            Worship · Vocals
          </div>
          {[
            { name: "Amara M.", state: "Confirmed" },
            { name: "Jordan D.", state: "Awaiting" },
          ].map((p) => (
            <div
              key={p.name}
              className="rounded-xl border border-neutral-200 bg-white p-3"
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary-400 text-[10px] font-semibold text-white">
                  {p.name
                    .split(" ")
                    .map((s) => s[0])
                    .join("")}
                </span>
                <span className="flex-1 text-[13px] font-medium text-neutral-900">
                  {p.name}
                </span>
                <span
                  className={`text-[10px] font-semibold ${
                    p.state === "Confirmed"
                      ? "text-green-600"
                      : "text-amber-600"
                  }`}
                >
                  {p.state}
                </span>
              </div>
            </div>
          ))}

          {/* A request as the volunteer would see it */}
          <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-3">
            <div className="text-[11px] text-neutral-500">
              You're on the schedule to serve Sun, Jun 15.
            </div>
            <div className="mt-2 flex gap-2">
              <span className="flex-1 rounded-full bg-green-600 px-3 py-1.5 text-center text-[11px] font-semibold text-white">
                Confirm
              </span>
              <span className="flex-1 rounded-full border border-neutral-200 px-3 py-1.5 text-center text-[11px] font-semibold text-neutral-500">
                Decline
              </span>
            </div>
          </div>
        </div>

        {/* Bottom publish bar */}
        <div className="flex-shrink-0 border-t border-neutral-200 bg-white p-3">
          <button className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white">
            Publish &amp; send requests
          </button>
        </div>
      </div>
    </PhoneFrame>
  );
}

/** Native availability card rendered inside a chat thread. */
function AvailabilityCardMock() {
  const events = [
    { title: "Sunday Service", date: "Sun, Jun 15 · 9:00 AM", state: "available" as const },
    { title: "Sunday Service", date: "Sun, Jun 22 · 9:00 AM", state: "none" as const },
    { title: "Midweek", date: "Wed, Jun 25 · 7:00 PM", state: "cant" as const },
  ];
  return (
    <PhoneFrame title="Worship Team">
      <div className="space-y-3 bg-neutral-50 p-3">
        {/* A normal message above the card */}
        <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 text-[12px] text-neutral-700 shadow-sm">
          When can everyone serve this month?
        </div>

        {/* The availability card bubble */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-1.5">
            <Ion name="calendar-outline" size={13} className="text-neutral-500" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-neutral-500">
              Availability
            </span>
          </div>
          <div className="mt-2 text-[12px] text-neutral-700">
            Let us know when you can serve this month 🙏
          </div>
          <div className="mt-0.5 text-[11px] text-neutral-500">
            Tap a date to share your availability
          </div>

          <div className="mt-3 space-y-2.5">
            {events.map((e, i) => (
              <div key={i}>
                <div className="text-[12px] font-semibold text-neutral-900">
                  {e.title}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-neutral-500">{e.date}</span>
                  <div className="flex gap-1.5">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                        e.state === "available"
                          ? "bg-green-600 text-white"
                          : "border border-neutral-200 text-neutral-500"
                      }`}
                    >
                      Available
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                        e.state === "cant"
                          ? "bg-red-600 text-white"
                          : "border border-neutral-200 text-neutral-500"
                      }`}
                    >
                      Can't
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-1.5 border-t border-neutral-100 pt-2 text-[11px] font-medium text-primary-700">
            <Ion name="link-outline" size={13} className="text-primary-700" />
            Copy link
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

/** (c) My Availability — green/red pills per upcoming plan. */
function AvailabilityMock() {
  const plans = [
    { title: "Sun · Jun 15", state: "available" as const },
    { title: "Sun · Jun 22", state: "cant" as const },
    { title: "Sun · Jun 29", state: "none" as const },
  ];
  return (
    <PhoneFrame title="My Availability">
      <div className="space-y-3 bg-neutral-50 p-3">
        <div className="text-[11px] text-neutral-500">
          Being available doesn't mean you're scheduled yet — it just tells your
          leaders when they can count on you.
        </div>
        {plans.map((p) => (
          <div
            key={p.title}
            className="rounded-xl border border-neutral-200 bg-white p-3"
          >
            <div className="mb-2 text-sm font-semibold text-neutral-900">
              {p.title}
            </div>
            <div className="flex gap-2">
              <span
                className={`flex-1 rounded-full px-3 py-1.5 text-center text-[11px] font-semibold ${
                  p.state === "available"
                    ? "bg-green-600 text-white"
                    : "border border-neutral-200 bg-white text-neutral-500"
                }`}
              >
                Available
              </span>
              <span
                className={`flex-1 rounded-full px-3 py-1.5 text-center text-[11px] font-semibold ${
                  p.state === "cant"
                    ? "bg-red-600 text-white"
                    : "border border-neutral-200 bg-white text-neutral-500"
                }`}
              >
                Can't make it
              </span>
            </div>
          </div>
        ))}
      </div>
    </PhoneFrame>
  );
}

/** Cross-team picker — step 1 (groups) + step 2 (roles), with chosen chips. */
function CrossTeamPickerMock() {
  return (
    <PhoneFrame title="New channel">
      <div className="space-y-3 bg-neutral-50 p-3">
        {/* Channel Type segmented control */}
        <div className="text-[11px] font-semibold text-neutral-600">
          Channel Type
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { label: "Custom", icon: "people-outline", active: false },
            { label: "Planning Center", icon: "sync-outline", active: false },
            { label: "Cross-team channel", icon: "git-merge-outline", active: true },
          ].map((t) => (
            <div
              key={t.label}
              className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-center ${
                t.active
                  ? "border-primary-400 bg-primary-50"
                  : "border-neutral-200 bg-white"
              }`}
            >
              <Ion
                name={t.icon}
                size={16}
                className={t.active ? "text-primary-700" : "text-neutral-400"}
              />
              <span
                className={`text-[9px] font-medium leading-tight ${
                  t.active ? "text-primary-800" : "text-neutral-500"
                }`}
              >
                {t.label}
              </span>
            </div>
          ))}
        </div>

        <div className="rounded-lg bg-primary-50 px-3 py-2 text-[10px] text-primary-800">
          Auto-syncs members rostered for chosen roles across multiple teams.
        </div>

        {/* Synced roles */}
        <div className="text-[11px] font-semibold text-neutral-600">
          Synced roles <span className="text-red-500">*</span>
        </div>

        {/* Step 1 */}
        <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
          1. Choose groups to draw from
        </div>
        <div className="space-y-1.5">
          {[
            { name: "Queens Campus", teams: "2 teams", on: true },
            { name: "Brooklyn Campus", teams: "1 team", on: true },
            { name: "Small Groups", teams: "1 team", on: false },
          ].map((g) => (
            <div
              key={g.name}
              className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-2"
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded ${
                  g.on
                    ? "bg-primary-600 text-[9px] text-white"
                    : "border border-neutral-300"
                }`}
              >
                {g.on ? "✓" : ""}
              </span>
              <span className="flex-1 text-[12px] font-medium text-neutral-800">
                {g.name}
              </span>
              <span className="text-[10px] text-neutral-400">{g.teams}</span>
            </div>
          ))}
        </div>

        {/* Step 2 */}
        <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
          2. Choose roles
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white">
          <div className="flex items-center gap-2 border-b border-neutral-100 px-2.5 py-2 text-[12px] font-semibold text-neutral-700">
            <Ion name="people-outline" size={14} className="text-neutral-400" />
            Worship
            <span className="ml-auto text-neutral-300">▾</span>
          </div>
          {[
            { name: "Any role on this team", on: false },
            { name: "Worship Lead", on: true },
            { name: "Vocals", on: false },
          ].map((r) => (
            <div
              key={r.name}
              className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-neutral-700"
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded ${
                  r.on
                    ? "bg-primary-600 text-[9px] text-white"
                    : "border border-neutral-300"
                }`}
              >
                {r.on ? "✓" : ""}
              </span>
              {r.name}
            </div>
          ))}
        </div>

        {/* Chosen chips */}
        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-medium text-primary-800">
            Worship — Worship Lead <span className="text-primary-400">✕</span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-medium text-primary-800">
            Production — Any role <span className="text-primary-400">✕</span>
          </span>
        </div>

        {/* Channel name */}
        <div className="text-[11px] font-semibold text-neutral-600">
          Channel Name <span className="text-red-500">*</span>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[12px] text-neutral-900">
          Sunday Leads
        </div>
      </div>
    </PhoneFrame>
  );
}

/** A resulting cross-team channel card on the Cross-team tab. */
function CrossTeamCardMock() {
  return (
    <PhoneFrame title="Rostering">
      <div className="bg-white">
        {/* Tab bar with Cross-team active */}
        <div className="flex border-b border-neutral-100 text-[12px] font-medium">
          <div className="flex-1 py-2 text-center text-neutral-400">
            Schedule
          </div>
          <div className="flex-1 py-2 text-center text-neutral-400">Teams</div>
          <div className="relative flex-1 py-2 text-center font-bold text-primary-700">
            Cross-team
            <span className="absolute bottom-0 left-1/2 h-[3px] w-[55%] -translate-x-1/2 rounded-full bg-primary-600" />
          </div>
        </div>

        <div className="space-y-2.5 bg-neutral-50 p-3">
          <button className="flex w-full items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-primary-400 py-2 text-[12px] font-semibold text-primary-700">
            <span className="text-base leading-none">+</span> New cross-team
            channel
          </button>

          {[
            {
              name: "Sunday Leads",
              members: "5 members",
              sub: "3 synced roles · Worship (Worship Lead) · Production (Any role)",
            },
            {
              name: "Broadcast",
              members: "8 members",
              sub: "4 synced roles · Queens (Service Director) · Brooklyn (Service Director)",
            },
          ].map((c) => (
            <div
              key={c.name}
              className="flex items-start gap-2.5 rounded-xl border border-neutral-200 bg-white p-3"
            >
              <Ion
                name="git-merge-outline"
                size={18}
                className="mt-0.5 text-neutral-500"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-neutral-900">
                    {c.name}
                  </span>
                  <span className="flex-shrink-0 text-[10px] text-neutral-400">
                    {c.members}
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] leading-snug text-neutral-500">
                  {c.sub}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </PhoneFrame>
  );
}

/** The run sheet — segmented, cascading clock times, song Key/BPM, role chip. */
function RunSheetMock() {
  return (
    <PhoneFrame title="Run sheet">
      <div className="flex h-full flex-col bg-neutral-50">
        <div className="flex-1 overflow-y-auto p-3">
          {/* Plan header */}
          <div className="text-[14px] font-bold text-neutral-900">
            Sunday Service
          </div>
          <div className="text-[11px] text-neutral-500">Sunday, June 15</div>
          <div className="mt-0.5 text-[10px] text-neutral-400">
            9:00 AM – 10:15 AM · 11:00 AM – 12:15 PM
          </div>

          {/* BEFORE EVENT */}
          <div className="mt-4 text-[10px] font-extrabold uppercase tracking-[0.08em] text-neutral-400">
            Before event
          </div>
          {[
            { time: "8:30 AM", title: "Doors open", dur: "0:00" },
            { time: "8:40 AM", title: "Team huddle & prayer", dur: "10:00" },
            { time: "8:50 AM", title: "Sound check", dur: "10:00" },
          ].map((r, i) => (
            <RunSheetRow key={i} {...r} />
          ))}

          {/* DURING EVENT */}
          <div className="mt-4 text-[10px] font-extrabold uppercase tracking-[0.08em] text-neutral-400">
            During event
          </div>
          {[
            { time: "9:00 AM", title: "Welcome", dur: "3:00", role: "Host: Amara" },
          ].map((r, i) => (
            <RunSheetRow key={`d${i}`} {...r} />
          ))}
          <RunSheetSongRow
            time="9:03 AM"
            title="Great Are You Lord"
            dur="5:30"
            songKey="A"
            bpm="72"
          />
          <RunSheetSongRow
            time="9:08 AM"
            title="King of Kings"
            dur="6:00"
            songKey="D"
            bpm="74"
            role="Vocals: Amara, Jordan"
          />
        </div>

        {/* Bottom add bar */}
        <div className="flex-shrink-0 border-t border-neutral-200 bg-white p-2.5">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] text-neutral-500">
            Add to:
            <span className="rounded-full border border-neutral-200 px-2 py-0.5">
              Before event
            </span>
            <span className="rounded-full bg-primary-600 px-2 py-0.5 font-semibold text-white">
              During event
            </span>
            <span className="rounded-full border border-neutral-200 px-2 py-0.5">
              After event
            </span>
          </div>
          <div className="flex gap-1.5">
            {["Add item", "Song", "Header"].map((b) => (
              <span
                key={b}
                className="flex-1 rounded-lg border border-dashed border-primary-300 py-1.5 text-center text-[11px] font-semibold text-primary-700"
              >
                {b}
              </span>
            ))}
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

function RunSheetRow({
  time,
  title,
  dur,
  role,
}: {
  time: string;
  title: string;
  dur: string;
  role?: string;
}) {
  return (
    <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2 py-2">
      <Ion name="reorder-three" size={14} className="text-neutral-300" />
      <span className="w-[52px] flex-shrink-0 text-[10px] font-semibold text-neutral-500">
        {time}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] text-neutral-900">{title}</div>
        {role && (
          <span className="mt-0.5 inline-block rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-medium text-violet-700">
            {role}
          </span>
        )}
      </div>
      <span className="flex-shrink-0 text-[10px] text-neutral-400">{dur}</span>
    </div>
  );
}

function RunSheetSongRow({
  time,
  title,
  dur,
  songKey,
  bpm,
  role,
}: {
  time: string;
  title: string;
  dur: string;
  songKey: string;
  bpm: string;
  role?: string;
}) {
  return (
    <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2 py-2">
      <Ion name="reorder-three" size={14} className="text-neutral-300" />
      <span className="w-[52px] flex-shrink-0 text-[10px] font-semibold text-neutral-500">
        {time}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px]">🎵</span>
          <span className="truncate text-[12px] font-medium text-neutral-900">
            {title}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[9px] font-medium text-neutral-600">
            Key {songKey}
          </span>
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[9px] font-medium text-neutral-600">
            BPM {bpm}
          </span>
          {role && (
            <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-medium text-rose-700">
              {role}
            </span>
          )}
        </div>
      </div>
      <span className="flex-shrink-0 text-[10px] text-neutral-400">{dur}</span>
    </div>
  );
}

/** Toolbar Settings — Run Sheet tool, show-to-members switch, visibility. */
function ToolbarSettingsMock() {
  return (
    <PhoneFrame title="Toolbar Settings">
      <div className="space-y-3 bg-neutral-50 p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          Toolbar Items
        </div>
        <div className="flex items-center gap-2.5 rounded-xl border border-neutral-200 bg-white p-3">
          <Ion name="list-outline" size={18} className="text-neutral-600" />
          <span className="flex-1 text-[13px] font-medium text-neutral-800">
            Run Sheet
          </span>
          <span className="flex h-5 w-9 items-center rounded-full bg-primary-600 px-0.5">
            <span className="ml-auto h-4 w-4 rounded-full bg-white" />
          </span>
        </div>

        <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          Toolbar Visibility
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <div className="flex-1 pr-2">
              <div className="text-[13px] font-medium text-neutral-800">
                Show toolbar to members
              </div>
              <div className="text-[10px] text-neutral-500">
                When enabled, non-leader members can see selected tools
              </div>
            </div>
            <span className="flex h-5 w-9 items-center rounded-full bg-primary-600 px-0.5">
              <span className="ml-auto h-4 w-4 rounded-full bg-white" />
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <div className="mb-2 text-[12px] font-medium text-neutral-800">
            Run Sheet
          </div>
          <div className="flex overflow-hidden rounded-lg border border-neutral-200 text-[11px] font-semibold">
            <span className="flex-1 py-1.5 text-center text-neutral-500">
              Leaders
            </span>
            <span className="flex-1 bg-primary-600 py-1.5 text-center text-white">
              Everyone
            </span>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

/* ---- Roster grid (desktop) ---- */

type CellStatus = "confirmed" | "awaiting" | "declined" | "open";

/** A small status-ringed avatar used inside grid cells. */
function GridAvatar({
  label,
  status,
}: {
  label: string;
  status: Exclude<CellStatus, "open">;
}) {
  const ring =
    status === "confirmed"
      ? "ring-green-500"
      : status === "awaiting"
        ? "ring-amber-500"
        : "ring-red-500";
  return (
    <span
      className={`-ml-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary-400 text-[9px] font-semibold text-white ring-2 ${ring} first:ml-0`}
    >
      {label}
    </span>
  );
}

/** A dashed "+" chip for an open slot. */
function OpenChip() {
  return (
    <span className="-ml-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-neutral-300 bg-neutral-50 text-[11px] font-semibold text-neutral-400 first:ml-0">
      +
    </span>
  );
}

type Cell = { avatars: { label: string; status: Exclude<CellStatus, "open"> }[]; open: number };

function GridCell({ cell }: { cell: Cell }) {
  const allConfirmed =
    cell.open === 0 &&
    cell.avatars.length > 0 &&
    cell.avatars.every((a) => a.status === "confirmed");
  const hasAwaiting = cell.avatars.some((a) => a.status === "awaiting");
  const tint = allConfirmed
    ? "bg-green-50"
    : hasAwaiting
      ? "bg-amber-50"
      : "bg-white";
  return (
    <td className="border-b border-l border-neutral-100 p-1.5">
      <div className={`flex items-center rounded-md ${tint} px-1.5 py-1`}>
        {cell.avatars.map((a, i) => (
          <GridAvatar key={i} label={a.label} status={a.status} />
        ))}
        {Array.from({ length: cell.open }).map((_, i) => (
          <OpenChip key={`o${i}`} />
        ))}
      </div>
    </td>
  );
}

/** The flagship roster grid, reconstructed as a static table. */
function RosterGridMock() {
  const columns = [
    { title: "Sunday Service", weekday: "Sun", date: "Jun 15", open: 1 },
    { title: "Sunday Service", weekday: "Sun", date: "Jun 22", open: 3 },
    { title: "Midweek", weekday: "Wed", date: "Jun 25", open: 0 },
    { title: "Sunday Service", weekday: "Sun", date: "Jun 29", open: 2 },
  ];

  const teams: {
    team: string;
    roles: {
      name: string;
      covered: [number, number];
      cells: Cell[];
    }[];
  }[] = [
    {
      team: "Worship",
      roles: [
        {
          name: "Vocals",
          covered: [3, 4],
          cells: [
            { avatars: [{ label: "AM", status: "confirmed" }, { label: "JD", status: "confirmed" }, { label: "RS", status: "confirmed" }], open: 0 },
            { avatars: [{ label: "AM", status: "confirmed" }, { label: "JD", status: "awaiting" }], open: 1 },
            { avatars: [{ label: "RS", status: "confirmed" }], open: 0 },
            { avatars: [{ label: "AM", status: "confirmed" }, { label: "KL", status: "declined" }], open: 1 },
          ],
        },
        {
          name: "Drums",
          covered: [3, 4],
          cells: [
            { avatars: [{ label: "TP", status: "confirmed" }], open: 0 },
            { avatars: [{ label: "TP", status: "awaiting" }], open: 0 },
            { avatars: [{ label: "TP", status: "confirmed" }], open: 0 },
            { avatars: [], open: 1 },
          ],
        },
        {
          name: "Keys",
          covered: [2, 4],
          cells: [
            { avatars: [{ label: "MK", status: "confirmed" }], open: 0 },
            { avatars: [], open: 1 },
            { avatars: [{ label: "MK", status: "confirmed" }], open: 0 },
            { avatars: [], open: 1 },
          ],
        },
      ],
    },
    {
      team: "Hospitality",
      roles: [
        {
          name: "Greeters",
          covered: [4, 4],
          cells: [
            { avatars: [{ label: "BW", status: "confirmed" }, { label: "CN", status: "confirmed" }], open: 0 },
            { avatars: [{ label: "BW", status: "awaiting" }, { label: "CN", status: "confirmed" }], open: 0 },
            { avatars: [{ label: "BW", status: "confirmed" }], open: 0 },
            { avatars: [{ label: "CN", status: "confirmed" }, { label: "DH", status: "confirmed" }], open: 0 },
          ],
        },
        {
          name: "Coffee",
          covered: [3, 4],
          cells: [
            { avatars: [{ label: "EF", status: "confirmed" }], open: 0 },
            { avatars: [{ label: "EF", status: "awaiting" }], open: 0 },
            { avatars: [], open: 1 },
            { avatars: [{ label: "EF", status: "confirmed" }], open: 0 },
          ],
        },
      ],
    },
  ];

  const totalResponded = 18;
  const totalPeople = 24;

  return (
    <DesktopFrame url="togather.nyc/rostering">
      <div className="min-w-[640px] p-4 text-neutral-800">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-base font-bold text-neutral-900">Roster</div>
            <div className="text-[11px] text-neutral-500">
              {columns.length} events · {totalResponded}/{totalPeople} responded
            </div>
          </div>
          <div className="flex overflow-hidden rounded-lg border border-neutral-200 text-[11px] font-semibold">
            <span className="bg-primary-600 px-3 py-1 text-white">Roles</span>
            <span className="bg-white px-3 py-1 text-neutral-500">People</span>
          </div>
        </div>

        {/* Legend */}
        <div className="mb-3 flex flex-wrap items-center gap-3 text-[10px] text-neutral-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
            Confirmed
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
            Awaiting
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
            Declined
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-neutral-400 bg-neutral-50" />
            Open
          </span>
        </div>

        {/* Grid */}
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-40 bg-white p-1.5" />
              {columns.map((c, i) => (
                <th
                  key={i}
                  className="border-b border-l border-neutral-100 p-1.5 align-top"
                >
                  <div className="truncate text-[10px] text-neutral-400">
                    {c.title}
                  </div>
                  <div className="text-[10px] uppercase text-neutral-400">
                    {c.weekday}
                  </div>
                  <div className="text-xs font-bold text-neutral-900">
                    {c.date}
                  </div>
                  <div className="text-[10px] text-neutral-400">
                    {c.open} open
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <Fragment key={t.team}>
                {/* Team band header */}
                <tr>
                  <td
                    colSpan={columns.length + 1}
                    className="sticky left-0 bg-neutral-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-400"
                  >
                    {t.team}
                  </td>
                </tr>
                {t.roles.map((role) => (
                  <tr key={`${t.team}-${role.name}`}>
                    <th className="sticky left-0 z-10 w-40 border-b border-neutral-100 bg-white p-1.5 text-left align-middle">
                      <div className="text-xs font-semibold text-neutral-900">
                        {role.name}
                      </div>
                      <div className="text-[10px] text-neutral-400">
                        covered {role.covered[0]}/{role.covered[1]}
                      </div>
                    </th>
                    {role.cells.map((cell, ci) => (
                      <GridCell key={ci} cell={cell} />
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </DesktopFrame>
  );
}
