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
import { PhoneFrame, Avatar } from "../../components/guide/PhoneFrame";
import { appLinks } from "../../guides/appLinks";

const toc: TocItem[] = [
  { id: "create", label: "Create groups for teams & campuses" },
  { id: "channels", label: "Every group has channels" },
  { id: "leaders", label: "Making someone a leader" },
  { id: "announcements", label: "The announcements channel" },
  { id: "scale", label: "Large churches" },
];

/* ------------------------------------------------------------------ */
/* Page-local mockups — code-reconstructed app screens for the figures */
/* ------------------------------------------------------------------ */

/** A single row in a channel list. */
function ChannelRow({
  icon,
  name,
  subtitle,
  muted = false,
  active = false,
}: {
  icon: ReactNode;
  name: string;
  subtitle?: string;
  muted?: boolean;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 border-b border-neutral-100 ${
        active ? "bg-primary-50" : ""
      } ${muted ? "opacity-50" : ""}`}
    >
      <span className="w-7 h-7 rounded-lg bg-neutral-100 flex items-center justify-center text-sm text-neutral-600 flex-shrink-0">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-neutral-900 truncate">
          {name}
        </div>
        {subtitle && (
          <div className="text-[11px] text-neutral-400 truncate">{subtitle}</div>
        )}
      </div>
    </div>
  );
}

/** (a) A group's channel list: general + locked leaders + announcements. */
function ChannelListMock() {
  return (
    <PhoneFrame title="Worship Team">
      <ChannelRow
        icon="#"
        name="general"
        subtitle="Everyone can read and post"
        active
      />
      <ChannelRow
        icon="🔒"
        name="leaders"
        subtitle="Private to leaders"
      />
      <ChannelRow
        icon="📣"
        name="Announcements"
        subtitle="Leaders post · everyone reads"
      />
    </PhoneFrame>
  );
}

/** A single member row with role pill. */
function MemberRow({
  label,
  color,
  name,
  role,
  highlighted = false,
}: {
  label: string;
  color?: string;
  name: string;
  role?: string;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 border-b border-neutral-100 ${
        highlighted ? "bg-primary-50" : ""
      }`}
    >
      <Avatar label={label} color={color} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-neutral-900 truncate">
          {name}
        </div>
      </div>
      {role && (
        <span className="text-[11px] font-semibold text-primary-700 bg-primary-100 rounded-full px-2 py-0.5">
          {role}
        </span>
      )}
    </div>
  );
}

/** (b) Member list with an open role menu offering "Promote to Leader". */
function MemberRoleMock() {
  return (
    <PhoneFrame title="Members">
      <MemberRow label="JR" name="Jordan Rivera" role="Leader" />
      <MemberRow
        label="SP"
        color="bg-accent-500"
        name="Sam Patel"
        highlighted
      />
      {/* Role action menu for the selected member */}
      <div className="px-4 py-3">
        <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
          <button
            type="button"
            className="w-full text-left px-4 py-2.5 text-sm font-medium text-primary-700 hover:bg-primary-50"
          >
            Promote to Leader
          </button>
          <div className="border-t border-neutral-100" />
          <button
            type="button"
            className="w-full text-left px-4 py-2.5 text-sm text-neutral-500 hover:bg-neutral-50"
          >
            Remove from group
          </button>
        </div>
      </div>
      <MemberRow
        label="MA"
        color="bg-neutral-400"
        name="Maria Alvarez"
        role="Member"
      />
    </PhoneFrame>
  );
}

/** (a/announcements) The announcements channel with a read-only composer. */
function AnnouncementsMock() {
  return (
    <PhoneFrame title="Announcements">
      <div className="px-4 py-3 bg-primary-50 border-b border-neutral-100 text-[11px] text-primary-700">
        Visible to all members · only leaders can post
      </div>
      <div className="px-4 py-4 space-y-3">
        <div className="flex gap-2">
          <Avatar label="JR" />
          <div className="rounded-2xl rounded-tl-sm bg-neutral-100 px-3 py-2 text-sm text-neutral-800 max-w-[80%]">
            Rehearsal moved to 6:30 this Thursday. See you there! 🙌
          </div>
        </div>
      </div>
      {/* Composer replaced by a read-only notice */}
      <div className="px-4 py-3 border-t border-neutral-100">
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-center text-xs text-neutral-500">
          Only leaders can post here. You can react to messages.
        </div>
      </div>
    </PhoneFrame>
  );
}

/** (c) Larger-church config: general OFF, announcements as primary. */
function LargeChurchConfigMock() {
  return (
    <PhoneFrame title="Channel settings">
      <ChannelRow
        icon="#"
        name="general"
        subtitle="Hidden — turned off"
        muted
      />
      <ChannelRow
        icon="🔒"
        name="leaders"
        subtitle="Private to leaders"
      />
      <ChannelRow
        icon="📣"
        name="Announcements"
        subtitle="Primary channel · leaders post"
        active
      />
      <div className="px-4 py-3 text-[11px] text-neutral-400 leading-relaxed">
        General is hidden. Members will not be able to use it until you turn it
        back on.
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
        Those conversations happen in <strong>channels</strong> — and a couple
        of them are created for you the moment a group exists. This guide walks
        through creating groups, the channels inside them, how to make someone a
        leader, and how larger churches keep things calm at scale.
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
          shared by accident.
        </P>

        <Steps>
          <Step n={1}>
            Open <DeepLink href={appLinks.groups}>Open groups</DeepLink> and tap{" "}
            <Term>Create group</Term> (or <Term>Request group</Term> if your
            church requires admin approval).
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
          set up per community, so the labels in your church may differ. Pick the
          type that best matches what the group is for.
        </Callout>
      </Section>

      <Section id="channels" title="Every group has channels">
        <P>
          When a group is created, Togather sets up two channels for you right
          away — you never start from a blank screen:
        </P>
        <P>
          A <Term>general</Term> channel where everyone in the group can read and
          post, and a private <Term>leaders</Term> channel that only the
          group&rsquo;s leaders and admins can see. The leaders channel is the
          quiet back room for planning and coordination that members don&rsquo;t
          need in their feed.
        </P>

        <Figure caption="A group's channel list: #general for everyone, a locked leaders channel, and Announcements.">
          {/* swap-in: <img src="/images/guides/channel-list.png" /> */}
          <ChannelListMock />
        </Figure>

        <Callout tone="note">
          The <Term>leaders</Term> channel is described in the app as
          &ldquo;Leaders channel is visible to leaders and admins of this
          group.&rdquo; If a member doesn&rsquo;t see it, that&rsquo;s working as
          intended — it&rsquo;s private on purpose.
        </Callout>
      </Section>

      <Section id="leaders" title="Making someone a leader">
        <P>
          Leaders keep a group running: they get the private leaders channel and
          they&rsquo;re the ones who can post announcements. Promoting someone
          takes a few taps from the group&rsquo;s member list.
        </P>

        <Steps>
          <Step n={1}>
            Open the group and go to its <Term>Members</Term> list.
          </Step>
          <Step n={2}>Tap the member you want to promote.</Step>
          <Step n={3}>
            Choose <Term>Promote to Leader</Term> from their role menu. Their
            badge changes from <Term>Member</Term> to <Term>Leader</Term>.
          </Step>
          <Step n={4}>
            They immediately gain access to the leaders channel and can post in
            the announcements channel.
          </Step>
        </Steps>

        <Figure caption="Open a member and choose Promote to Leader to change their role.">
          {/* swap-in: <img src="/images/guides/member-role-menu.png" /> */}
          <MemberRoleMock />
        </Figure>

        <Callout tone="warn" title="Announcement groups are different">
          In announcement-type groups (like your church-wide announcements),
          roles aren&rsquo;t set by hand. The app will tell you: &ldquo;Roles are
          managed automatically based on community admin status.&rdquo; To change
          who can post there, change who is a community admin.
        </Callout>
      </Section>

      <Section id="announcements" title="The announcements channel">
        <P>
          Alongside <Term>general</Term> and <Term>leaders</Term>, a group can
          have an <Term>Announcements</Term> channel. It&rsquo;s a one-way
          broadcast: leaders post, and every member can read — but members
          can&rsquo;t reply. It&rsquo;s the right place for &ldquo;here&rsquo;s
          what&rsquo;s happening&rdquo; messages that shouldn&rsquo;t turn into a
          thread.
        </P>
        <P>
          The app describes the channel exactly this way:{" "}
          <em>
            &ldquo;Leader announcements — visible to all members; only leaders
            can post.&rdquo;
          </em>
        </P>

        <Figure caption="In Announcements the composer is replaced by a read-only notice for members.">
          {/* swap-in: <img src="/images/guides/announcements-channel.png" /> */}
          <AnnouncementsMock />
        </Figure>

        <Callout tone="note">
          When a member opens Announcements, they don&rsquo;t see a text box.
          Instead they see &ldquo;Only leaders can post in Announcements. You can
          react to messages.&rdquo; — so the channel stays clean while members
          can still show they&rsquo;ve seen a post.
        </Callout>
      </Section>

      <Section id="scale" title="Large churches: turn off general, use announcements">
        <P>
          A wide-open <Term>general</Term> channel is wonderful for a small team
          where everyone knows each other. For a large congregation it can get
          noisy fast — hundreds of people all able to post means the important
          messages get buried.
        </P>
        <P>
          For bigger churches we recommend a simpler shape: turn the{" "}
          <Term>general</Term> channel off and make <Term>Announcements</Term>{" "}
          the primary channel. Only leaders broadcast, and members read — calm,
          clear, and easy to follow.
        </P>
        <P>
          You control this with each channel&rsquo;s <Term>enabled</Term> toggle
          in the channel settings: switch <Term>general</Term> off and leave{" "}
          <Term>Announcements</Term> on. Turning general off hides it from
          members but keeps their memberships, so you can always switch it back
          on later.
        </P>

        <Figure caption="A large-church setup: general turned off, Announcements as the primary channel.">
          {/* swap-in: <img src="/images/guides/large-church-config.png" /> */}
          <LargeChurchConfigMock />
        </Figure>

        <Callout tone="tip" title="Reversible at any time">
          Disabling a channel is not the same as deleting it. The app keeps the
          history and memberships, so if you ever want the open conversation
          back, flip <Term>general</Term> on again and everything returns just as
          it was.
        </Callout>
      </Section>
    </GuideLayout>
  );
}
