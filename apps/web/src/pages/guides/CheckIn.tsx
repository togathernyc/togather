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
import { PhoneFrame, Avatar } from "../../components/guide/PhoneFrame";
import { appLinks } from "../../guides/appLinks";

const toc: TocItem[] = [
  { id: "heart", label: "The heart of check-in" },
  { id: "screen", label: "The Check-in screen" },
  { id: "scores", label: "Scores" },
  { id: "assign", label: "Assigning people" },
  { id: "reach", label: "Reaching out" },
];

/**
 * Guide post: "Check-ins & follow-up."
 *
 * Reconstructs the leader-facing Check-in screen — the triaged people list, the
 * three-score member cards, the assign sheet, and the reach-out sheet — as code
 * mockups. Labels and score bands are kept in sync with the check-in feature
 * (apps/mobile features/check-in + apps/convex check-in functions).
 */
export function CheckIn() {
  return (
    <GuideLayout slug="check-in" toc={toc}>
      <Lead>
        You can't control how often people show up — but you can control how well
        you follow up. Check-in is about leaving the ninety-nine for the one:
        making sure that as your community grows, nobody slips through
        unnoticed.
      </Lead>

      <Section id="heart" title="The heart of check-in">
        <P>
          Every leader knows the feeling of realizing, weeks too late, that
          someone quietly stopped coming. Check-in exists to catch that earlier.
          It surfaces the people who need a touch right now and gives you a
          simple way to reach out and remember that you did.
        </P>
        <Callout tone="note">
          This isn't about chasing attendance numbers. It's about care — making
          sure the people God has put in front of you actually get seen.
        </Callout>
      </Section>

      <Section id="screen" title="The Check-in screen">
        <P>
          Open Check-in for a group and you get a searchable list of its people,
          triaged into three collapsible sections so the most urgent rise to the
          top:
        </P>
        <P>
          <Term>NEEDS ATTENTION</Term> (red) for people slipping away,{" "}
          <Term>WATCH</Term> (amber) for those to keep an eye on, and{" "}
          <Term>HEALTHY</Term> (green, collapsed by default) for everyone who's
          doing well. Within each section, people are ordered lowest score
          first, so whoever needs you most is always right at the top.
        </P>

        <Figure caption="The Check-in screen — people triaged by how they're doing.">
          <PeopleListMock />
        </Figure>

        <P>
          Want to try it? Open your groups, pick a group, then open{" "}
          <Term>Check-in</Term>. This opens your own live community, signed in as
          you.
        </P>
        <DeepLink href={appLinks.groups}>Open your groups</DeepLink>
      </Section>

      <Section id="scores" title="Scores">
        <P>
          Each member card carries three scores. <Term>Connection</Term> is the
          headline follow-up score — a composite of recent attendance and how
          recently someone reached out, decaying over time so it cools off if no
          one's been in touch. <Term>Attendance</Term> is the percentage of
          meetings attended, and <Term>Service</Term> reflects how they're
          serving.
        </P>
        <P>
          The bands are simple: <Term>needs attention</Term> below 40,{" "}
          <Term>watch</Term> from 40 to 69, and <Term>healthy</Term> at 70 and
          above. A one-line reason always explains the number — something like{" "}
          <Term>14d since contact · missed last 3</Term> — so the score is never
          a mystery.
        </P>
      </Section>

      <Section id="assign" title="Assigning people to leaders">
        <P>
          Care works best when someone owns it. Tap a member's assignee line —{" "}
          <Term>Unassigned · tap to assign</Term> — and a sheet titled{" "}
          <Term>Assign {"{name}"}</Term> opens. You can tap{" "}
          <Term>Assign to me</Term>, or pick from searchable, multi-select lists
          under <Term>GROUP LEADERS</Term> and{" "}
          <Term>OTHER COMMUNITY LEADERS</Term>, then <Term>Save</Term>.
        </P>
        <P>
          Assigned members show up on that leader's plate, and the leader gets a
          notification so they know someone's now in their care.
        </P>

        <Figure caption="Assigning a member to a leader.">
          <AssignSheetMock />
        </Figure>
      </Section>

      <Section id="reach" title="Reaching out">
        <P>
          When you're ready to make contact, tap <Term>Reach out →</Term>. A
          sheet offers three ways to connect: <Term>Text</Term> (opens Messages
          and logs as a text), <Term>Call</Term> (opens the dialer and logs as a
          call), and <Term>Log in-person</Term> (for when you've already seen
          them — no message is sent). You can add an optional note to any of
          them.
        </P>
        <P>
          Every logged touch immediately lifts that person's Connection score.
          The system rewards actual care, not streaks — what counts is that you
          reached out.
        </P>

        <Figure caption="The Reach out sheet — three ways to make contact.">
          <ReachOutSheetMock />
        </Figure>

        <Callout tone="tip">
          Logged a quick hallway chat with <Term>Log in-person</Term>? That
          counts too. The point is to capture care wherever it happens, so the
          next leader to look knows this person's been seen.
        </Callout>
      </Section>
    </GuideLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Page-local UI mockups                                              */
/* ------------------------------------------------------------------ */

type Member = {
  name: string;
  initials: string;
  assignee: string;
  connection: number;
  attendance: number;
  service: number;
  reason: string;
};

function bandColor(score: number) {
  if (score < 40) return { dot: "bg-red-500", text: "text-red-600" };
  if (score < 70) return { dot: "bg-amber-500", text: "text-amber-600" };
  return { dot: "bg-green-500", text: "text-green-600" };
}

function MemberCard({ m }: { m: Member }) {
  const band = bandColor(m.connection);
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
      <div className="flex items-center gap-3">
        <Avatar label={m.initials} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-neutral-900">{m.name}</div>
          <div className="truncate text-[11px] text-neutral-400">
            {m.assignee}
          </div>
        </div>
      </div>

      {/* Three-score row */}
      <div className="mt-3 flex items-stretch gap-2 text-center">
        <div className="flex-1 rounded-lg bg-neutral-50 px-2 py-1.5">
          <div className="flex items-center justify-center gap-1">
            <span className={`h-2 w-2 rounded-full ${band.dot}`} />
            <span className={`text-base font-bold ${band.text}`}>
              {m.connection}
            </span>
          </div>
          <div className="text-[9px] uppercase tracking-wide text-neutral-400">
            Connection
          </div>
        </div>
        <div className="flex-1 rounded-lg bg-neutral-50 px-2 py-1.5">
          <div className="text-sm font-semibold text-neutral-700">
            {m.attendance}%
          </div>
          <div className="text-[9px] uppercase tracking-wide text-neutral-400">
            Attendance
          </div>
        </div>
        <div className="flex-1 rounded-lg bg-neutral-50 px-2 py-1.5">
          <div className="text-sm font-semibold text-neutral-700">
            {m.service}%
          </div>
          <div className="text-[9px] uppercase tracking-wide text-neutral-400">
            Service
          </div>
        </div>
      </div>

      <div className="mt-2 text-[11px] text-neutral-500">{m.reason}</div>

      <div className="mt-2 flex justify-end">
        <span className="rounded-full bg-primary-600 px-3 py-1 text-[11px] font-semibold text-white">
          Reach out →
        </span>
      </div>
    </div>
  );
}

/** (a) The triaged people list. */
function PeopleListMock() {
  const needsAttention: Member[] = [
    {
      name: "Marcus Bell",
      initials: "MB",
      assignee: "Unassigned · tap to assign",
      connection: 28,
      attendance: 35,
      service: 0,
      reason: "14d since contact · missed last 3",
    },
    {
      name: "Priya Shah",
      initials: "PS",
      assignee: "Assigned to you",
      connection: 36,
      attendance: 50,
      service: 20,
      reason: "21d since contact · attendance falling",
    },
  ];
  const watch: Member[] = [
    {
      name: "Daniel Okoye",
      initials: "DO",
      assignee: "Assigned to Sarah L.",
      connection: 58,
      attendance: 70,
      service: 40,
      reason: "8d since contact",
    },
  ];

  return (
    <PhoneFrame title="Check-in">
      <div className="bg-neutral-50">
        {/* Search */}
        <div className="px-3 pt-3">
          <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[11px] text-neutral-400">
            <span>🔍</span>
            Search people
          </div>
        </div>

        {/* Needs attention */}
        <div className="px-3 pt-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-red-600">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            Needs attention
            <span className="text-neutral-400">{needsAttention.length}</span>
          </div>
          <div className="space-y-2">
            {needsAttention.map((m) => (
              <MemberCard key={m.name} m={m} />
            ))}
          </div>
        </div>

        {/* Watch */}
        <div className="px-3 pt-4">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-amber-600">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            Watch
            <span className="text-neutral-400">{watch.length}</span>
          </div>
          <div className="space-y-2">
            {watch.map((m) => (
              <MemberCard key={m.name} m={m} />
            ))}
          </div>
        </div>

        {/* Healthy (collapsed) */}
        <div className="px-3 py-4">
          <div className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white px-3 py-2">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-green-600">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Healthy
              <span className="text-neutral-400">31</span>
            </div>
            <span className="text-neutral-400">▾</span>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

/** (b) The assign-to-leader sheet. */
function AssignSheetMock() {
  const groupLeaders = [
    { name: "Sarah Lewis", initials: "SL", selected: true },
    { name: "James Park", initials: "JP", selected: false },
  ];
  const communityLeaders = [
    { name: "Grace Nwosu", initials: "GN", selected: false },
    { name: "Tomas Rivera", initials: "TR", selected: false },
  ];
  return (
    <PhoneFrame title="Assign Marcus Bell">
      <div className="space-y-4 bg-white p-3">
        <button className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white">
          Assign to me
        </button>

        <div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            Group leaders
          </div>
          <div className="space-y-2">
            {groupLeaders.map((l) => (
              <LeaderRow key={l.name} {...l} />
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            Other community leaders
          </div>
          <div className="space-y-2">
            {communityLeaders.map((l) => (
              <LeaderRow key={l.name} {...l} />
            ))}
          </div>
        </div>

        <button className="w-full rounded-xl bg-neutral-900 py-2.5 text-sm font-semibold text-white">
          Save
        </button>
      </div>
    </PhoneFrame>
  );
}

function LeaderRow({
  name,
  initials,
  selected,
}: {
  name: string;
  initials: string;
  selected: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-2.5">
      <Avatar label={initials} />
      <div className="flex-1 text-sm font-medium text-neutral-900">{name}</div>
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${
          selected
            ? "border-primary-600 bg-primary-600 text-white"
            : "border-neutral-300 text-transparent"
        }`}
      >
        ✓
      </span>
    </div>
  );
}

/** (c) The reach-out sheet. */
function ReachOutSheetMock() {
  const options = [
    { label: "Text", sub: "Opens Messages · logs as text", icon: "💬" },
    { label: "Call", sub: "Opens dialer · logs as call", icon: "📞" },
    { label: "Log in-person", sub: "Already saw them · no message sent", icon: "🤝" },
  ];
  return (
    <PhoneFrame title="Reach out">
      <div className="space-y-3 bg-white p-3">
        <div className="text-[11px] text-neutral-500">
          Marcus Bell · every logged touch lifts their Connection score.
        </div>
        {options.map((o) => (
          <div
            key={o.label}
            className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-base">
              {o.icon}
            </span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-neutral-900">
                {o.label}
              </div>
              <div className="text-[11px] text-neutral-500">{o.sub}</div>
            </div>
            <span className="text-neutral-300">›</span>
          </div>
        ))}

        <div>
          <div className="mb-1 text-[11px] font-medium text-neutral-500">
            Note (optional)
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] text-neutral-400">
            Add a note about this reach-out…
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}
