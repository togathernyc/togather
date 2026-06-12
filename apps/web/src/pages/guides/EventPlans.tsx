import { Fragment } from "react";
import { GuideLayout, type TocItem } from "../../components/guide/GuideLayout";
import {
  Lead,
  Section,
  P,
  Callout,
  Term,
  Figure,
} from "../../components/guide/primitives";
import { PhoneFrame } from "../../components/guide/PhoneFrame";
import { DesktopFrame } from "../../components/guide/DesktopFrame";

const toc: TocItem[] = [
  { id: "what", label: "What event plans are" },
  { id: "teams", label: "Teams & roles" },
  { id: "plans", label: "Event plans" },
  { id: "availability", label: "Availability" },
  { id: "grid", label: "The roster grid" },
  { id: "runsheet", label: "Run sheets" },
];

/**
 * Guide post: "Event plans: teams, rostering & run sheets."
 *
 * Togather's answer to Planning Center Services. Reconstructs the rostering UI
 * as code mockups — the My Availability screen, a published plan card, the
 * desktop roster grid, and the run sheet. Labels are kept in sync with the
 * rostering feature (apps/mobile features/rostering + apps/convex rostering
 * functions). No live demo fixture exists for this surface yet.
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

      <Section id="teams" title="Teams & roles">
        <P>
          Inside a group's Rostering area, leaders create the teams that do the
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

        <Figure caption="A serving team and its roles inside the group's Rostering area.">
          <TeamSetupMock />
        </Figure>
      </Section>

      <Section id="plans" title="Event plans">
        <P>
          Tap <Term>+ New event plan</Term> to start a draft — it defaults to
          next Sunday at 9:00 AM. A plan has a date and one or more{" "}
          <Term>service times</Term> (say 9:00 AM and 11:00 AM), and the needed
          roles per team via <Term>Set needed roles</Term>. Everything
          auto-saves as you go.
        </P>
        <P>
          A plan starts as a <Term>Draft</Term>. When you're ready, tap{" "}
          <Term>Publish &amp; send requests</Term>: every volunteer with an open
          request gets a push notification <em>and</em> an SMS asking them to
          accept or decline. Each plan card shows a fill-progress bar reading{" "}
          <Term>{"{filled}/{needed} filled"}</Term> alongside the confirmed
          count, so you can see at a glance which days still need people.
        </P>

        <Figure caption="A published plan card with its fill-progress bar.">
          <PlanCardMock />
        </Figure>
      </Section>

      <Section id="availability" title="Availability">
        <P>
          Members tell you when they can serve from <Term>My Availability</Term>.
          For each upcoming plan they tap <Term>Available</Term> or{" "}
          <Term>Can't make it</Term>. Being available doesn't mean you're
          scheduled yet — it just tells leaders who they can draw from.
        </P>
        <P>
          Leaders can also share a public availability link
          (togather.nyc/a/…) that works <em>without</em> the app. Recipients
          verify by phone number, and their responses match back to their
          Togather account. Either way, availability flows straight into the
          editor, which shows{" "}
          <Term>{"{a} available · {b} can't · {c} no response"}</Term> for each
          plan.
        </P>

        <Figure caption="My Availability — members mark each upcoming plan.">
          <AvailabilityMock />
        </Figure>

        <Callout tone="tip" title="No app required">
          The public availability link is great for volunteers who haven't
          installed the app yet. They confirm by phone number and you still get
          their answer in the grid.
        </Callout>
      </Section>

      <Section id="grid" title="The roster grid">
        <P>
          The roster grid is the heart of rostering, and it shines on a big
          screen. Roles run down the left, grouped by team; each event plan is a
          column; and every cell shows who's filling that role for that day —
          confirmed, awaiting, or declined — plus any open slots still to fill.
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

      <Section id="runsheet" title="Run sheets">
        <P>
          Every plan also gets one shared run sheet — the order of service for
          the day. It's a spreadsheet-style editor with inline editing: type a
          duration and the start times cascade automatically down the list.
          Segments group the day into <Term>Before event</Term>,{" "}
          <Term>During event</Term>, and <Term>After event</Term>, and you drag
          rows to reorder them.
        </P>
        <P>
          Rows can link to a <Term>role</Term> — which resolves to whoever ends
          up filling it — and to <Term>songs</Term> from your community's song
          library, so the team running the day always has the latest list in
          front of them.
        </P>
      </Section>
    </GuideLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Page-local UI mockups                                              */
/* ------------------------------------------------------------------ */

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
