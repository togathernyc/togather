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
  { id: "what", label: "What is a group type?" },
  { id: "create", label: "Create a group type" },
  { id: "events", label: "Community-wide events" },
  { id: "explore", label: "Explore & filtering" },
  { id: "naming", label: "A tip on naming" },
];

/**
 * Guide post: "Group types and why they matter."
 *
 * Reconstructs three in-app screens as code mockups (admin list, Explore
 * filtering, community-wide event form). Default group-type names and the
 * create-form fields are kept in sync with the seeded data in
 * apps/convex/functions/seed.ts and apps/convex/functions/admin/settings.ts.
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
          A group type is a category that every group belongs to. When your
          community is created, Togather starts you off with a sensible set of
          defaults: <Term>Small Groups</Term>, <Term>Teams</Term>,{" "}
          <Term>Classes</Term>, and <Term>Announcements</Term>.
        </P>
        <P>
          Nothing here is set in stone. From admin you can rename a type,
          reorder them, add new ones that fit your church's culture, or
          deactivate any you don't use. Your groups, your labels.
        </P>

        <Figure caption="Group types admin — your community's default categories.">
          {/* swap-in: <img src="/images/guides/group-types.png" /> */}
          <GroupTypesAdminMock />
        </Figure>

        <Callout tone="note" title="Live preview">
          This is the real admin settings screen running in your browser with
          sample data — scroll down to the <Term>Group Types</Term> section to
          see the defaults and the <Term>Add New</Term> action.
        </Callout>
        <Figure caption="The live admin settings screen — Group Types running on mock data.">
          <SettingsLiveDemo />
        </Figure>
      </Section>

      <Section id="create" title="Create a group type">
        <P>
          Adding a type takes a few seconds. Open Group Types from your admin
          area and create one — give it a name, an optional description, an
          icon, and a display order that decides where it sits in the list.
        </P>

        <Steps>
          <Step n={1}>
            Open <Term>Group Types</Term> from your community's admin area.
          </Step>
          <Step n={2}>
            Tap <Term>Add group type</Term> and enter a{" "}
            <Term>name</Term> (Togather builds the <Term>slug</Term> from it
            automatically).
          </Step>
          <Step n={3}>
            Add an optional <Term>description</Term>, pick an{" "}
            <Term>icon</Term>, and set the <Term>display order</Term>.
          </Step>
          <Step n={4}>
            Save. New types are active (<Term>isActive</Term>) by default, so
            they're ready to use right away.
          </Step>
        </Steps>

        <DeepLink href={appLinks.groupTypes}>Open group types</DeepLink>
      </Section>

      <Section id="events" title="Why they matter: community-wide events">
        <P>
          Here's where group types really earn their keep. They power
          community-wide events: as an admin you can schedule one event scoped
          to a group type — say <Term>Teams</Term> — and Togather automatically
          creates a meeting for every active group of that type. One form,
          every team's calendar updated.
        </P>

        <Figure caption="A community-wide event scoped to a group type.">
          {/* swap-in: <img src="/images/guides/group-types.png" /> */}
          <CommunityWideEventMock />
        </Figure>

        <Callout tone="note">
          Schedule once, reach every group. If you have ten <Term>Teams</Term>,
          one community-wide event creates ten meetings — no copy-pasting. We
          cover this end to end in the Events guide.
        </Callout>
      </Section>

      <Section id="explore" title="Why they matter: Explore & filtering">
        <P>
          Group types also shape how people find their way in. On the Explore
          screen, members filter and discover groups by group type, so someone
          looking for a class isn't wading through every team and small group.
          As an admin you can choose which types appear by default.
        </P>

        <Figure caption="Explore — members filter groups by group type.">
          {/* swap-in: <img src="/images/guides/group-types.png" /> */}
          <ExploreFilterMock />
        </Figure>
      </Section>

      <Section id="naming" title="A tip on naming">
        <P>
          Keep your types broad and few. A short, clear list helps people find
          their group quickly — a sprawling one just adds friction.
        </P>

        <Callout tone="tip">
          Throughout the app, prefer a type's display name for labels rather
          than hardcoding categories. Display names can differ from one
          community to the next, so leaning on the name keeps everything reading
          the way your church expects.
        </Callout>
      </Section>
    </GuideLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Page-local UI mockups                                              */
/* ------------------------------------------------------------------ */

/**
 * Live demo: the REAL admin SettingsContent screen rendered via
 * react-native-web with mock data (see apps/web/demo/settings.tsx). Embedded in
 * a phone frame so it reads as the in-app screen.
 */
function SettingsLiveDemo() {
  return (
    <PhoneFrame title="Settings">
      <iframe
        src="/demo/settings.html"
        title="Live admin settings — Group Types"
        className="w-full h-full block border-0"
      />
    </PhoneFrame>
  );
}

const DEFAULT_TYPES = [
  { name: "Small Groups", desc: "Weekly small group gatherings", count: 6, icon: "👥" },
  { name: "Teams", desc: "Ministry and service teams", count: 4, icon: "🧰" },
  { name: "Classes", desc: "Educational classes and workshops", count: 3, icon: "📖" },
  { name: "Announcements", desc: "Community announcements", count: 1, icon: "📣" },
];

/** (a) Group-types admin list with the seeded defaults. */
function GroupTypesAdminMock() {
  return (
    <PhoneFrame title="Group Types">
      <div className="p-3 space-y-2 bg-neutral-50">
        {DEFAULT_TYPES.map((t) => (
          <div
            key={t.name}
            className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-base">
              {t.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-neutral-900">
                {t.name}
              </div>
              <div className="truncate text-[11px] text-neutral-500">
                {t.desc}
              </div>
            </div>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500">
              {t.count}
            </span>
          </div>
        ))}
        <button className="w-full rounded-xl border border-dashed border-primary-300 bg-primary-50/50 py-2.5 text-sm font-semibold text-primary-700">
          + Add group type
        </button>
      </div>
    </PhoneFrame>
  );
}

/** (b) Explore page with group-type filter chips. */
function ExploreFilterMock() {
  const chips = ["All", "Small Groups", "Teams", "Classes"];
  const results = [
    { name: "Young Adults", type: "Small Groups", lead: "JD" },
    { name: "Worship Team", type: "Teams", lead: "MK" },
    { name: "Intro to the Bible", type: "Classes", lead: "RS" },
  ];
  return (
    <PhoneFrame title="Explore">
      <div className="bg-white">
        <div className="flex gap-2 overflow-hidden px-3 py-3">
          {chips.map((c, i) => (
            <span
              key={c}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-medium ${
                i === 1
                  ? "border-primary-600 bg-primary-600 text-white"
                  : "border-neutral-200 bg-white text-neutral-600"
              }`}
            >
              {c}
            </span>
          ))}
        </div>
        <div className="space-y-2 px-3 pb-3">
          {results.map((r) => (
            <div
              key={r.name}
              className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3"
            >
              <Avatar label={r.lead} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-neutral-900">
                  {r.name}
                </div>
                <div className="text-[11px] text-neutral-500">{r.type}</div>
              </div>
            </div>
          ))}
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
            Event name
          </div>
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800">
            Quarterly Team Huddle
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
            <span className="font-medium text-neutral-900">Teams</span>
            <span className="text-neutral-400">▾</span>
          </div>
          <div className="mt-1.5 text-[11px] text-neutral-500">
            Creates a meeting for every active group of this type.
          </div>
        </div>

        <button className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white">
          Schedule event
        </button>
      </div>
    </PhoneFrame>
  );
}
