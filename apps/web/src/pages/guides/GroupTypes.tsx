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
  { id: "what", label: "What is a group type?" },
  { id: "starter", label: "A starting set for churches" },
  { id: "create", label: "Create your group types" },
  { id: "events", label: "Community-wide events" },
  { id: "explore", label: "Explore & filtering" },
  { id: "naming", label: "Name types in the singular" },
];

/**
 * Guide post: "Group types and why they matter."
 *
 * Mockups mirror the real app screens: the Group Types card in Admin →
 * Settings (apps/mobile admin settings), the New Group Type bottom sheet, and
 * the Explore map's filter modal / group cards. The only auto-created type is
 * Announcements — everything else is created by the church.
 */
export function GroupTypes() {
  return (
    <GuideLayout slug="group-types" toc={toc}>
      <Lead>
        Group types are the backbone of how your community is organized. Before
        you create a single group, it's worth deciding your group types — they
        categorize every group your church creates and quietly unlock some of
        Togather's most useful community-wide features.
      </Lead>

      <Section id="what" title="What is a group type?">
        <P>
          A group type is a category that every group belongs to. The type's
          name appears as a colored badge on each group's card, it powers the
          filters on the Explore map, and it's how admins schedule one event
          across many groups at once.
        </P>
        <P>
          When your community is created, Togather sets up exactly one thing
          for you: an <Term>Announcements</Term> group type with a single
          announcement group named after your community. Every member is
          automatically in it, nobody can leave it, and roles inside it mirror
          community-admin status on their own. Everything else — every other
          type and every other group — is yours to create.
        </P>

        <Callout tone="note" title="One announcements group per community">
          There should be exactly one announcements group, and the app creates
          and manages it for you. You'll never need to add another group to
          the <Term>Announcements</Term> type — spend your energy on the types
          below instead.
        </Callout>
      </Section>

      <Section id="starter" title="A starting set for churches">
        <P>
          Since Togather doesn't pre-fill categories for you, here's the set we
          recommend most churches start with:
        </P>
        <P>
          <Term>Team</Term> — for serving teams: worship, hospitality, kids,
          production, and so on. Each team group gets its own chat, its own
          events, and its own rostering, so your worship team can plan a setlist
          while the kids team schedules check-in shifts.
        </P>
        <P>
          <Term>Small Group</Term> — whatever your church calls them: life
          groups, community groups, connect groups. One type covers them all,
          and the name on the badge is whatever you choose.
        </P>
        <P>
          <Term>Campus</Term> — for multi-site churches, create one group per
          campus (say Brooklyn, Manhattan, and Queens) all under a single{" "}
          <Term>Campus</Term> type. That lets you push uniform community-wide
          events across every campus at once, while each campus group still
          runs its own rostering and serving requests. Central teams that span
          campuses can live as regular <Term>Team</Term> groups, and a
          campus-specific crew — a "Brooklyn Kids Team" that needs to
          self-organize — simply gets its own team group.
        </P>
        <P>
          Optionally, add a <Term>Course</Term> (or <Term>Class</Term>) type
          for classes, membership courses, and other things with a start and an
          end.
        </P>

        <Figure caption="The Group Types card in Admin → Settings, with a starting set created.">
          {/* swap-in: <img src="/images/guides/group-types.png" /> */}
          <GroupTypesSettingsMock />
        </Figure>
      </Section>

      <Section id="create" title="Create your group types">
        <P>
          Group types live in your admin settings, in a card titled{" "}
          <Term>Group Types</Term>. Adding one takes a few seconds — it's just
          a name and an optional description.
        </P>

        <Steps>
          <Step n={1}>
            Open <Term>Admin</Term> → <Term>Settings</Term> and scroll to the{" "}
            <Term>Group Types</Term> card.
          </Step>
          <Step n={2}>
            Tap <Term>Add New</Term> in the card's header.
          </Step>
          <Step n={3}>
            Enter a <Term>Name</Term> (e.g., "Small Group") and an optional
            one-line <Term>Description</Term>.
          </Step>
          <Step n={4}>
            Tap <Term>Create</Term>. The type is ready to use immediately —
            you'll pick it whenever you create a group.
          </Step>
        </Steps>

        <Figure caption="The New Group Type sheet — just a name and an optional description.">
          {/* swap-in: <img src="/images/guides/group-types.png" /> */}
          <NewGroupTypeModalMock />
        </Figure>

        <P>
          Ready to set yours up? This opens your own live community, signed in
          as you.
        </P>
        <DeepLink href={appLinks.groupTypes}>
          Open Group Types in your settings
        </DeepLink>
      </Section>

      <Section id="events" title="Why they matter: community-wide events">
        <P>
          Here's where group types really earn their keep. Community-wide
          events target a group type: as an admin you create one event — say
          "all Small Groups meet Wednesday at 7" — and Togather creates a
          linked copy of it in every small group at once.
        </P>
        <P>
          The copies stay linked, but group leaders keep control of their own.
          A leader can edit their group's copy (editing disconnects that copy
          from future parent updates) or cancel just theirs without touching
          anyone else's. Combined with series — the same event across multiple
          dates — one action can schedule a whole semester across twenty
          groups.
        </P>

        <Figure caption="One community-wide event becomes a linked copy in every group of that type.">
          <CommunityWideEventDiagram />
        </Figure>

        <Callout tone="note">
          For multi-site churches this is the payoff of a <Term>Campus</Term>{" "}
          type: one community-wide event lands on every campus's calendar in a
          single step. We cover community-wide events end to end in the Events
          guide.
        </Callout>
      </Section>

      <Section id="explore" title="Why they matter: Explore & filtering">
        <P>
          Group types also shape how people find their way in. Explore is a
          full-screen map with a draggable sheet of groups, and the floating
          filter button opens a filter by group type — so someone looking for a
          small group isn't wading through every team and class. Every group
          card carries its type as a colored badge, too.
        </P>

        <Figure caption="Explore — group cards carry the type badge, and the filter modal narrows by group type.">
          {/* swap-in: <img src="/images/guides/group-types.png" /> */}
          <div className="flex flex-wrap items-start justify-center gap-6">
            <ExploreMapMock />
            <ExploreFiltersMock />
          </div>
        </Figure>
      </Section>

      <Section id="naming" title="Name types in the singular">
        <P>
          Name your group types in the singular: <Term>Team</Term>, not
          "Teams"; <Term>Small Group</Term>, not "Small Groups";{" "}
          <Term>Dinner Party</Term>, not "Dinner Parties". The type label
          appears as a badge on each individual group's card, so the singular
          reads correctly — "SMALL GROUP" on the Young Adults card, not "SMALL
          GROUPS".
        </P>

        <Callout tone="tip">
          Beyond naming, keep your list of types broad and few. A short, clear
          list helps people find their group quickly — a sprawling one just
          adds friction.
        </Callout>
      </Section>
    </GuideLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Page-local UI mockups                                              */
/* ------------------------------------------------------------------ */

/** Default community primary color (the green used for admin actions). */
const PRIMARY = "#1E8449";

const STARTER_TYPES = [
  {
    name: "Team",
    desc: "Serving teams — worship, hospitality, kids",
    count: 8,
  },
  {
    name: "Small Group",
    desc: "Weekly gatherings in homes around the city",
    count: 12,
  },
  {
    name: "Campus",
    desc: "One group per campus location",
    count: 3,
  },
  {
    name: "Announcements",
    desc: "Community announcements",
    count: 1,
  },
];

/** Ionicons-style add-circle glyph used by the card's "Add New" action. */
function AddCircleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={PRIMARY}>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" />
    </svg>
  );
}

/** (a) The Group Types card in Admin → Settings, as it appears in the app. */
function GroupTypesSettingsMock() {
  return (
    <PhoneFrame title="Settings">
      <div className="bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-base font-semibold text-neutral-900">
            Group Types
          </div>
          <span
            className="flex items-center gap-1 text-sm font-medium"
            style={{ color: PRIMARY }}
          >
            <AddCircleIcon />
            Add New
          </span>
        </div>
        <div className="space-y-2">
          {STARTER_TYPES.map((t) => (
            <div
              key={t.name}
              className="flex items-center rounded-lg border border-neutral-200 bg-[#f5f5f5] p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold text-neutral-900">
                  {t.name}
                </div>
                <div className="truncate text-sm text-neutral-500">
                  {t.desc}
                </div>
                <div className="mt-0.5 text-xs text-neutral-400">
                  {t.count} {t.count === 1 ? "group" : "groups"}
                </div>
              </div>
              <span className="ml-2 text-lg text-neutral-300">›</span>
            </div>
          ))}
        </div>
      </div>
    </PhoneFrame>
  );
}

/** (b) The New Group Type bottom sheet — name + optional description. */
function NewGroupTypeModalMock() {
  return (
    <PhoneFrame>
      <div className="relative flex h-full flex-col bg-neutral-200">
        {/* Dimmed settings screen behind the sheet. */}
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative mt-auto rounded-t-2xl bg-white p-4 pb-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-base font-semibold text-neutral-900">
              New Group Type
            </div>
            <span className="text-lg leading-none text-neutral-400">✕</span>
          </div>

          <div className="mb-1 text-sm font-medium text-neutral-700">
            Name *
          </div>
          <div className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-400">
            e.g., Small Group, Bible Study
          </div>

          <div className="mb-1 text-sm font-medium text-neutral-700">
            Description
          </div>
          <div className="mb-5 h-20 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-400">
            Brief description of this group type...
          </div>

          <div className="flex gap-3">
            <span className="flex-1 rounded-lg bg-neutral-200 py-2.5 text-center text-sm font-semibold text-neutral-700">
              Cancel
            </span>
            <span
              className="flex-1 rounded-lg py-2.5 text-center text-sm font-semibold text-white"
              style={{ backgroundColor: PRIMARY }}
            >
              Create
            </span>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

/** Conceptual fan-out: one community-wide event → a linked copy per group. */
function CommunityWideEventDiagram() {
  const copies = [
    { group: "Young Adults", note: "Linked to parent" },
    { group: "Eastside Group", note: "Edited by leader — detached" },
    { group: "Riverside Group", note: "Linked to parent" },
  ];
  return (
    <div className="w-full max-w-md">
      <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
        <div className="mb-1 flex items-center gap-2">
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase text-white"
            style={{ backgroundColor: PRIMARY }}
          >
            Community-wide
          </span>
          <span className="text-[11px] text-neutral-400">
            every Small Group
          </span>
        </div>
        <div className="text-sm font-semibold text-neutral-900">
          Midweek Gathering
        </div>
        <div className="text-[11px] text-neutral-500">Wednesday · 7:00 PM</div>
      </div>

      <div className="my-2 flex justify-center">
        <span className="text-neutral-300">↓ ↓ ↓</span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {copies.map((c) => (
          <div
            key={c.group}
            className="rounded-xl border border-neutral-200 bg-white p-2.5"
          >
            <div className="text-xs font-semibold text-neutral-900">
              {c.group}
            </div>
            <div className="text-[11px] text-neutral-500">Wed · 7:00 PM</div>
            <div className="mt-1 text-[10px] text-neutral-400">{c.note}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Small overlapping member avatars used on Explore group cards. */
function MemberStack() {
  const members = ["JD", "MK", "RS"];
  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {members.map((m) => (
          <span
            key={m}
            className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-primary-400 text-[9px] font-semibold text-white"
          >
            {m}
          </span>
        ))}
      </div>
      <span className="ml-1.5 text-[11px] text-neutral-500">+9</span>
    </div>
  );
}

/** (c) Explore — full-screen map, draggable sheet, search, badged group card. */
function ExploreMapMock() {
  return (
    <PhoneFrame>
      <div className="relative flex h-full flex-col">
        {/* Map */}
        <div className="relative flex-1 overflow-hidden bg-[#e8f0e9]">
          <div className="absolute left-0 right-0 top-1/3 h-2 -rotate-6 bg-white/70" />
          <div className="absolute bottom-0 top-0 left-1/4 w-2 rotate-12 bg-white/70" />
          <span className="absolute left-1/4 top-1/4 h-4 w-4 rounded-full border-2 border-white bg-[#3498DB] shadow" />
          <span className="absolute left-2/3 top-1/2 h-4 w-4 rounded-full border-2 border-white bg-[#8E44AD] shadow" />
          <span
            className="absolute left-1/2 top-1/3 h-4 w-4 rounded-full border-2 border-white shadow"
            style={{ backgroundColor: PRIMARY }}
          />
          {/* Floating filter button with active-filter count badge. */}
          <div className="absolute right-3 top-3">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white shadow">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#404040"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <line x1="4" y1="7" x2="20" y2="7" />
                <circle cx="9" cy="7" r="2" fill="white" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <circle cx="15" cy="12" r="2" fill="white" />
                <line x1="4" y1="17" x2="20" y2="17" />
                <circle cx="7" cy="17" r="2" fill="white" />
              </svg>
              <span
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
                style={{ backgroundColor: PRIMARY }}
              >
                1
              </span>
            </span>
          </div>
        </div>
        {/* Draggable bottom sheet. */}
        <div
          className="relative -mt-3 flex flex-col rounded-t-2xl bg-white shadow-[0_-2px_8px_rgba(0,0,0,0.08)]"
          style={{ height: "58%" }}
        >
          <div className="flex justify-center py-2">
            <span className="h-1 w-9 rounded-full bg-neutral-300" />
          </div>
          <div className="mx-3 mb-3 rounded-full bg-neutral-100 px-3 py-2 text-sm text-neutral-400">
            Search groups...
          </div>
          <div className="min-h-0 flex-1 overflow-hidden px-3">
            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
              <div className="relative h-[180px] bg-gradient-to-br from-primary-200 to-primary-400">
                <span className="absolute left-2 top-2 rounded-sm bg-[#3498DB] px-1.5 py-0.5 text-[11px] font-bold uppercase text-white">
                  Small Group
                </span>
              </div>
              <div className="p-3">
                <div className="text-sm font-semibold text-neutral-900">
                  Young Adults
                </div>
                <div className="mb-2 text-[11px] text-neutral-500">
                  Brooklyn, NY
                </div>
                <MemberStack />
              </div>
            </div>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

const FILTER_TYPES = [
  { name: "All Types", color: null },
  { name: "Team", color: PRIMARY },
  { name: "Small Group", color: "#3498DB" },
  { name: "Campus", color: "#8E44AD" },
];

/** (c) The Explore filter modal — chips per group type plus meeting type. */
function ExploreFiltersMock() {
  const selectedType = "Small Group";
  const meeting = ["All", "In-Person", "Online"];
  return (
    <PhoneFrame>
      <div className="relative flex h-full flex-col bg-neutral-200">
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative mt-auto rounded-t-2xl bg-white p-4 pb-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-base font-semibold text-neutral-900">
              Filters
            </div>
            <span className="text-lg leading-none text-neutral-400">✕</span>
          </div>

          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Group Type
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {FILTER_TYPES.map((t) => {
              const selected = t.name === selectedType;
              return (
                <span
                  key={t.name}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                    selected
                      ? "border-transparent text-white"
                      : "border-neutral-200 bg-white text-neutral-600"
                  }`}
                  style={
                    selected
                      ? { backgroundColor: t.color ?? "#262626" }
                      : undefined
                  }
                >
                  {t.name}
                </span>
              );
            })}
          </div>

          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Meeting Type
          </div>
          <div className="flex flex-wrap gap-2">
            {meeting.map((m, i) => (
              <span
                key={m}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                  i === 0
                    ? "border-transparent text-white"
                    : "border-neutral-200 bg-white text-neutral-600"
                }`}
                style={i === 0 ? { backgroundColor: PRIMARY } : undefined}
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}
