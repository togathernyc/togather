import type { ReactNode } from "react";
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
  { id: "create", label: "Create groups for teams & campuses" },
  { id: "channels", label: "The channels inside a group" },
  { id: "custom-channels", label: "Custom channels & invite links" },
  { id: "leaders", label: "Members & leaders" },
  { id: "make-leader", label: "Making someone a leader" },
];

/* ------------------------------------------------------------------ */
/* Page-local mockups — code-reconstructed app screens for the figures */
/*                                                                     */
/* These reconstruct real Togather screens closely enough to teach     */
/* from. Icons are inline SVGs that mirror the Ionicons used in the    */
/* app (chatbubbles, star, megaphone, chatbubble, etc.).               */
/* ------------------------------------------------------------------ */

/** Inline Ionicons-style glyphs, sized to fill a 40×40 round container. */
function Icon({ name, color }: { name: string; color: string }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 512 512",
    fill: color,
    "aria-hidden": true,
  } as const;
  switch (name) {
    case "chatbubbles":
      return (
        <svg {...common}>
          <path d="M398.33 105.84C372.18 78.71 333.07 64 288 64c-88.22 0-160 65.95-160 147s71.78 147 160 147a204 204 0 0046.54-5.39 10 10 0 018.13 1.6l40.7 26.74a13.5 13.5 0 0020.84-12.62l-3.26-36.62a8.36 8.36 0 013-7.15C434.2 360.36 448 333.2 448 304c0-23.49-9.32-45.62-25.31-64.27l-.13-.15z" />
          <path d="M167.71 416.71c-39.29 0-71.06-25.66-71.06-57.32 0-9.46 2.84-18.46 8.05-26.39a4.39 4.39 0 00-2.41-6.62A111 111 0 0164 304c-35.35 0-64-25.55-64-57S28.65 190 64 190q3.51 0 7 .35" opacity="0" />
        </svg>
      );
    case "star":
      return (
        <svg {...common}>
          <path d="M394 480a16 16 0 01-9.39-3L256 383.76 127.39 477a16 16 0 01-24.55-18.08L153 310.35 23 221.2a16 16 0 019-29.2h160.38l48.4-148.95a16 16 0 0130.44 0l48.4 149H480a16 16 0 019.05 29.2L359 310.35l50.13 148.53A16 16 0 01394 480z" />
        </svg>
      );
    case "megaphone":
      return (
        <svg {...common}>
          <path d="M48 271.92v-31.84a16 16 0 0110.35-15L224 160v192L58.35 286.91a16 16 0 01-10.35-14.99zM272 354.05V157.95l165.71-65.08A16 16 0 01464 107.92v296.16a16 16 0 01-26.29 15.05zM112 384v-12.28l-48-18.86V408a40 40 0 0040 40h0a40 40 0 0040-40v-11.18l-32-12.58z" />
        </svg>
      );
    case "chatbubble":
      return (
        <svg {...common}>
          <path d="M408 64H104a72.08 72.08 0 00-72 72v224a72.08 72.08 0 0072 72h63.72l34.69 50.06a16 16 0 0026.32-.18L262.39 432H408a72.08 72.08 0 0072-72V136a72.08 72.08 0 00-72-72z" />
        </svg>
      );
    case "person-add":
      return (
        <svg {...common}>
          <path d="M288 256a112 112 0 10-112-112 112 112 0 00112 112zm0 32c-69.42 0-208 42.88-208 128v32a16 16 0 0016 16h280a8 8 0 005.71-13.62A175.49 175.49 0 01336 365.13" />
          <path d="M496 224h-48v-48a16 16 0 00-32 0v48h-48a16 16 0 000 32h48v48a16 16 0 0032 0v-48h48a16 16 0 000-32z" />
        </svg>
      );
    case "arrow-up":
      return (
        <svg {...common}>
          <path d="M256 464a16 16 0 01-16-16V92.42l-94.13 94.13a16 16 0 01-22.62-22.63l121.44-121.45a16 16 0 0122.62 0L390.75 163.9a16 16 0 01-22.62 22.63L274 92.42V448a16 16 0 01-16 16z" />
        </svg>
      );
    case "person-remove":
      return (
        <svg {...common}>
          <path d="M288 256a112 112 0 10-112-112 112 112 0 00112 112zm0 32c-69.42 0-208 42.88-208 128v32a16 16 0 0016 16h280a8 8 0 005.71-13.62A175.49 175.49 0 01336 365.13" />
          <path d="M496 240H352a16 16 0 000 32h144a16 16 0 000-32z" />
        </svg>
      );
    case "add":
      return (
        <svg {...common}>
          <path d="M256 112v288M400 256H112" stroke={color} strokeWidth="48" strokeLinecap="round" fill="none" />
        </svg>
      );
    case "link":
      return (
        <svg {...common} fill="none" stroke={color} strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
          <path d="M208 352h-64a96 96 0 010-192h64M304 160h64a96 96 0 010 192h-64M163.29 256h187.42" />
        </svg>
      );
    default:
      return <svg {...common} />;
  }
}

/** A round 40×40 icon container tinted with the icon color at ~15% opacity. */
function ChannelIcon({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
      style={{ backgroundColor: `${color}26` }}
    >
      <Icon name={name} color={color} />
    </span>
  );
}

/** Chevron used at the trailing edge of iOS-settings-style rows. */
function Chevron() {
  return (
    <svg
      className="flex-shrink-0 text-neutral-300"
      width="16"
      height="16"
      viewBox="0 0 512 512"
      fill="currentColor"
      aria-hidden
    >
      <path d="M184.49 136.49a16 16 0 0122.62 0l112 112a16 16 0 010 22.62l-112 112a16 16 0 01-22.62-22.62L284.69 256 184.49 159.11a16 16 0 010-22.62z" />
    </svg>
  );
}

/** A single iOS-settings-style channel row. */
function ChannelRow({
  icon,
  color,
  name,
  subtitle,
  unread,
}: {
  icon: string;
  color: string;
  name: string;
  subtitle: string;
  unread?: number;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <ChannelIcon name={icon} color={color} />
      <div className="min-w-0 flex-1">
        <div className="text-[16px] font-semibold text-neutral-900 truncate leading-tight">
          {name}
        </div>
        <div className="text-[13px] text-neutral-400 truncate">{subtitle}</div>
      </div>
      {unread != null && (
        <span
          className="flex-shrink-0 min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center text-[11px] font-semibold text-white"
          style={{ backgroundColor: color }}
        >
          {unread}
        </span>
      )}
      <Chevron />
    </div>
  );
}

const PRIMARY = "#1E8449"; // community primary (default green)
const ORANGE = "#FFA500";
const RED = "#E11D48";
const CYAN = "#00BCD4";

/** (a) The CHANNELS card with the four canonical rows + Create Channel row. */
function ChannelListMock() {
  return (
    <PhoneFrame title="Worship Team">
      <div className="px-4 pt-4">
        <div className="rounded-2xl bg-white border border-neutral-200 overflow-hidden divide-y divide-neutral-100">
          <div className="px-4 pt-3 pb-1 text-[11px] font-semibold tracking-[0.08em] text-neutral-400">
            CHANNELS
          </div>
          <ChannelRow
            icon="chatbubbles"
            color={PRIMARY}
            name="General"
            subtitle="All members"
          />
          <ChannelRow
            icon="star"
            color={ORANGE}
            name="Leaders"
            subtitle="3 leaders"
          />
          <ChannelRow
            icon="megaphone"
            color={RED}
            name="Announcements"
            subtitle="48 members · Leaders post"
            unread={2}
          />
          <ChannelRow
            icon="chatbubble"
            color={CYAN}
            name="Prayer Chain"
            subtitle="12 members"
          />
        </div>

        {/* Leaders-only: Create Channel row card */}
        <div className="mt-3 rounded-2xl bg-white border border-neutral-200 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3">
            <span
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${PRIMARY}26` }}
            >
              <Icon name="add" color={PRIMARY} />
            </span>
            <div
              className="text-[16px] font-semibold flex-1"
              style={{ color: PRIMARY }}
            >
              Create Channel
            </div>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

/** A member row: white card, 44px avatar, name, role pill, chevron. */
function MemberRow({
  label,
  color,
  name,
  isLeader,
  dimmed = false,
}: {
  label: string;
  color?: string;
  name: ReactNode;
  isLeader?: boolean;
  dimmed?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 ${
        dimmed ? "opacity-40" : ""
      }`}
    >
      <span
        className={`inline-flex items-center justify-center w-11 h-11 rounded-full ${
          color ?? "bg-primary-400"
        } text-white text-sm font-semibold flex-shrink-0`}
      >
        {label}
      </span>
      <div className="min-w-0 flex-1 text-[15px] font-medium text-neutral-900 truncate">
        {name}
      </div>
      {isLeader && (
        <span
          className="text-[11px] font-semibold rounded-full px-2 py-0.5"
          style={{ backgroundColor: `${PRIMARY}1A`, color: PRIMARY }}
        >
          Leader
        </span>
      )}
      <Chevron />
    </div>
  );
}

/** A row inside the member-action bottom sheet. */
function SheetRow({
  icon,
  label,
  color = "#111827",
}: {
  icon: string;
  label: string;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <Icon name={icon} color={color} />
      <span className="text-[16px] font-medium" style={{ color }}>
        {label}
      </span>
    </div>
  );
}

/** (b) Member list (dimmed) with the member-action bottom sheet over it. */
function MemberActionSheetMock() {
  return (
    <PhoneFrame title="Members">
      {/* Group-name subtitle + person-add affordance under the title */}
      <div className="px-4 pt-1 pb-2 flex items-center justify-between">
        <span className="text-[12px] text-neutral-400">Worship Team</span>
        <Icon name="person-add" color={PRIMARY} />
      </div>

      {/* Dimmed underlying member list */}
      <div className="relative">
        <div className="px-4 pb-4 space-y-3 pointer-events-none">
          {/* Search bar */}
          <div className="rounded-xl bg-neutral-100 px-3 py-2 text-[13px] text-neutral-400 opacity-40">
            Search members...
          </div>
          {/* Channel filter chips */}
          <div className="flex gap-2 opacity-40">
            <span
              className="text-[12px] font-medium text-white rounded-full px-3 py-1"
              style={{ backgroundColor: PRIMARY }}
            >
              All
            </span>
            <span className="text-[12px] font-medium text-neutral-600 bg-neutral-100 rounded-full px-3 py-1">
              General
            </span>
            <span className="text-[12px] font-medium text-neutral-600 bg-neutral-100 rounded-full px-3 py-1">
              Prayer Chain
            </span>
          </div>
          <MemberRow label="JR" name="Jordan Rivera (you)" isLeader dimmed />
          <MemberRow
            label="SP"
            color="bg-accent-500"
            name="Sam Patel"
            dimmed
          />
          <MemberRow
            label="MA"
            color="bg-neutral-400"
            name="Maria Alvarez"
            dimmed
          />
        </div>

        {/* Bottom-sheet action modal */}
        <div className="absolute inset-x-0 bottom-0">
          <div className="rounded-t-3xl bg-white border-t border-neutral-200 shadow-2xl overflow-hidden">
            <div className="flex justify-center pt-2 pb-1">
              <span className="w-9 h-1 rounded-full bg-neutral-300" />
            </div>
            <div className="px-4 pb-2 text-center text-[15px] font-semibold text-neutral-900">
              Sam Patel
            </div>
            <div className="divide-y divide-neutral-100">
              <SheetRow icon="chatbubble" label="View profile" />
              <SheetRow icon="arrow-up" label="Promote to Leader" />
              <SheetRow
                icon="person-remove"
                label="Remove from Group"
                color={RED}
              />
            </div>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

/* ------------------------------------------------------------------ */

export function GroupsAndChannels() {
  return (
    <GuideLayout slug="groups-and-channels" toc={toc}>
      <Lead>
        Groups are how your church&rsquo;s teams, ministries, and campuses live
        in Togather. Each group has its own members, events, and conversations.
        Those conversations happen in <strong>channels</strong> — and two of
        them are created for you the moment a group exists. This guide covers
        creating groups, the channels inside them, the custom channels and
        invite links leaders can spin up, and how members and leaders differ.
      </Lead>

      <Section id="create" title="Create groups for teams & campuses">
        <P>
          A group always belongs to a <Term>group type</Term> — the category
          that decides where it shows up and how it behaves. Think of group
          types as the shelves (Teams, Campuses, Small Groups) and groups as the
          things on them. A few examples:
        </P>
        <P>
          A <strong>Worship Team</strong> group under the <Term>Teams</Term>{" "}
          type, a <strong>Downtown Campus</strong> group for a specific
          location, or a <strong>Tuesday Small Group</strong> that meets weekly.
          Each one gets its own members, channels, and events — nothing is
          shared by accident. A group inherits the label of its type, so it
          shows up as a &ldquo;Team&rdquo; or a &ldquo;Campus&rdquo; wherever
          it&rsquo;s listed.
        </P>

        <Steps>
          <Step n={1}>
            Open <Term>Groups</Term> and tap <Term>Create group</Term> (or{" "}
            <Term>Request group</Term> if your church requires admin approval).
          </Step>
          <Step n={2}>
            Choose the <Term>group type</Term> — for the Worship Team you&rsquo;d
            pick <strong>Teams</strong>.
          </Step>
          <Step n={3}>
            Give it a clear name your members will recognize, like{" "}
            <strong>Worship Team</strong> or <strong>Downtown Campus</strong>.
          </Step>
          <Step n={4}>
            Add the people who belong in it. They become members straight away,
            and their channels appear for them automatically.
          </Step>
        </Steps>

        <Callout tone="tip" title="Group types vary by church">
          The exact group types you see — Teams, Campuses, Small Groups — are
          set up per community, so the labels in your church may differ. A group
          always inherits its type&rsquo;s label, so pick the type that best
          matches what the group is for.
        </Callout>

        <P>
          Ready to create one? This opens your own live community, signed in as
          you.
        </P>
        <DeepLink href={appLinks.groups}>Open your groups</DeepLink>
      </Section>

      <Section id="channels" title="The channels inside a group">
        <P>
          When a group is created, Togather sets up exactly{" "}
          <strong>two channels</strong> for you right away — you never start from
          a blank screen:
        </P>
        <P>
          <Term>General</Term>, which every member of the group can read and
          post in, and <Term>Leaders</Term>, a private channel only the
          group&rsquo;s leaders can see. The Leaders channel is the quiet back
          room for planning and coordination that members don&rsquo;t need in
          their feed. If a member doesn&rsquo;t see it, that&rsquo;s working as
          intended.
        </P>
        <P>
          A third channel, <Term>Announcements</Term>, is{" "}
          <strong>opt-in per group</strong>. A leader taps to enable it; once
          it&rsquo;s on, leaders post and every member reads. It&rsquo;s the
          right place for &ldquo;here&rsquo;s what&rsquo;s happening&rdquo;
          messages that shouldn&rsquo;t turn into a thread. This is distinct from
          your community-wide announcement group — the Announcements channel is
          scoped to just this one group.
        </P>

        <Figure caption="A group's CHANNELS card: General for all members, the leaders-only Leaders channel, an enabled Announcements channel, and a custom Prayer Chain. Leaders also see Create Channel.">
          <ChannelListMock />
        </Figure>

        <Callout tone="note">
          The four rows above are the canonical ones: General (all members),
          Leaders (leaders only), Announcements (opt-in; leaders post, members
          read), and any custom channels a leader has created. Before
          Announcements is enabled, its row reads &ldquo;Tap to enable — leaders
          post, members read.&rdquo;
        </Callout>

        <P>
          <strong>Community admins</strong> can look inside any group&rsquo;s
          channels — including Leaders — <strong>without joining</strong>. Open a
          group you&rsquo;re not a member of and a <Term>Channels</Term> section
          appears; tap any channel to read the conversation. This is{" "}
          <strong>read-only</strong>: instead of the message box you&rsquo;ll see
          &ldquo;You&rsquo;re viewing as a community admin. Join the group to
          post.&rdquo; Browsing this way doesn&rsquo;t add you to the group or its
          roster, so members aren&rsquo;t notified and your inbox stays clear.
        </P>
      </Section>

      <Section id="custom-channels" title="Custom channels & invite links">
        <P>
          Beyond the built-in channels, leaders can create their own{" "}
          <Term>custom channels</Term> — up to <strong>20 per group</strong>.
          A custom channel is perfect for an opt-in subgroup: a prayer chain, a
          class cohort, or a volunteer interest list that not everyone in the
          group needs to be in.
        </P>
        <P>
          Each custom channel has a <Term>join mode</Term> that decides how
          people get in:
        </P>
        <Steps>
          <Step n={1}>
            <strong>Open</strong> — &ldquo;Anyone in the group can join via
            invite link.&rdquo; Share the link and people add themselves.
          </Step>
          <Step n={2}>
            <strong>Approval required</strong> — &ldquo;Members must request and
            be approved by a leader.&rdquo; Good when you want to keep an eye on
            who joins.
          </Step>
        </Steps>

        <P>
          Custom channels also have <Term>invite links</Term>. A leader can
          share a link in the format <Term>togather.nyc/ch/…</Term>, regenerate
          it (the old link dies instantly), or disable it entirely. That makes
          links the easiest way to grow an opt-in subgroup without adding people
          by hand.
        </P>

        <Callout tone="tip" title="Regenerating kills the old link">
          When you regenerate a channel invite link, the previous one stops
          working immediately. Use that if a link was shared too widely — make a
          new one and the old one can&rsquo;t be used to join.
        </Callout>

        <P>
          Every channel also has an optional <Term>composer hint</Term>. From a
          channel&rsquo;s info screen, under <strong>Leader controls</strong>,
          tap <strong>Composer hint</strong> to set the placeholder text that
          shows in the message box — for example &ldquo;put experience updates
          here.&rdquo; It&rsquo;s a gentle nudge that steers people toward
          posting the right kind of message in each thread. Leave it empty to
          fall back to the default &ldquo;Message…&rdquo; placeholder.
        </P>
      </Section>

      <Section id="leaders" title="Members & leaders">
        <P>
          Inside a group there are two roles: <Term>member</Term> and{" "}
          <Term>leader</Term>. (Community admin is a separate role that lives at
          the community level, not inside a single group.) Most people are
          members — they can read and post in General, join custom channels they
          have access to, and read Announcements.
        </P>
        <P>
          <Term>Leaders</Term> keep the group running. A leader can:
        </P>
        <Steps>
          <Step n={1}>
            Create custom channels and enable the Announcements channel.
          </Step>
          <Step n={2}>
            Post in the Announcements channel (members can only read it).
          </Step>
          <Step n={3}>
            Manage channel invite links and approve or decline join requests,
            and set a composer hint to guide what members post in each channel.
          </Step>
          <Step n={4}>
            Add, remove, and promote members within the group.
          </Step>
          <Step n={5}>
            Run the group&rsquo;s events, rostering, and follow-ups.
          </Step>
        </Steps>
      </Section>

      <Section id="make-leader" title="Making someone a leader">
        <P>
          Promoting someone takes a few taps from the group&rsquo;s member list.
          Open the group, go to <Term>Members</Term>, and tap the person you
          want to promote — a bottom-sheet action menu slides up.
        </P>

        <Steps>
          <Step n={1}>
            Open the group and go to its <Term>Members</Term> list. You can
            search or filter by channel to find someone.
          </Step>
          <Step n={2}>Tap the member&rsquo;s row to open the action sheet.</Step>
          <Step n={3}>
            Choose <Term>Promote to Leader</Term>. Their role pill changes from{" "}
            <Term>Member</Term> to <Term>Leader</Term>. (For an existing leader
            this row reads <Term>Demote to Member</Term> instead.)
          </Step>
          <Step n={4}>
            They immediately gain the Leaders channel and everything else a
            leader can do.
          </Step>
        </Steps>

        <Figure caption="Tap a member to open the action sheet: View profile, Promote to Leader, or Remove from Group.">
          <MemberActionSheetMock />
        </Figure>

        <Callout tone="warn" title="Announcement groups are different">
          In announcement-type groups (like your church-wide announcements),
          roles aren&rsquo;t set by hand. The app will tell you: &ldquo;Roles are
          managed automatically based on community admin status.&rdquo; To change
          who can post there, change who is a community admin.
        </Callout>
      </Section>
    </GuideLayout>
  );
}
