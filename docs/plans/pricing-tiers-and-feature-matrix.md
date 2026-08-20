# Pricing tiers and feature matrix

**Status:** Draft proposal. Nothing here is shipped or committed. The live
pricing model is still `docs/architecture/decisions/ADR-030-per-active-member-billing.md`
($1/month per billable active member, one plan, no tiers) and the live public promise is still `apps/web` `/guides/pricing`.

**Purpose:** Togather is repositioning from a church app into a horizontal
community platform sold in three tiers — Free, Community, Enterprise. Before
the tiers can be priced, we need to know what we actually have to sell. This
document is the feature extraction: every user-facing capability in the
codebase, mapped to a proposed tier, plus the boundary logic, the gaps between
what Enterprise promises and what exists, and the enforcement work that a tiered
product requires.

---

## 1. The shape the product already has

Three facts from the schema decide most of the tier design, and one of them
contradicts how the tiers have been described so far.

**A group cannot exist without a community.** `groups.communityId` is a
required field (`apps/convex/schema.ts`). There is no Togather-level group, and
no WhatsApp/GroupMe-style standalone group. Every user reaches groups by first
entering a community. So the Free tier is not "one group with no community" —
it is **one community whose group count is capped**. That is the only shape the
data model supports, and changing it would be a rewrite, not a feature.

**A group is already a whole club.** A single group contains chat channels,
events with RSVP and attendance, resources, tasks, bots, a leader toolbar,
follow-up scoring, and a shareable public page. A run club or a student club
fits inside one group with room to spare. The thing a group cannot do is see
across to another group.

**There is no entity above a community.** No org, network, or diocese table;
`userCommunities` lets one person belong to many communities, but nothing rolls
them up. Enterprise's "campus-wide community" is one large community and works
today; Enterprise's "diocese / church network rollup" is a new entity that does
not exist.

## 2. What is billable and what gates anything today

| Mechanism | Where | What it does | Tier-ready? |
| --- | --- | --- | --- |
| `communities.billingModel` | `schema.ts` | `"per_active_user"` or legacy fixed-price | Records how they pay, not what they get |
| `communities.churchFeatures` | `schema.ts` | `prayerEnabled`, `eventTasksEnabled` | The only per-community feature switch that exists |
| `featureFlags` table | `/admin/features` | App-wide kill switches, staff-flipped | Global, not per-community |
| `userCommunities.roles` | `lib/permissions.ts` | Member 1 / Admin 3 / Primary Admin 4 | Who inside a community, not which plan |
| Billable active member | `functions/memberActivity.ts` | Real account, active membership, `lastLogin` inside 30 days | The meter the Community tier should keep using |

**There is no plan concept.** Nothing in the schema says "this community is on
Free." Every limit in the matrix below is new enforcement, not a switch to flip.
See §7.

## 3. Feature inventory

Extracted from `apps/convex/functions`, `apps/mobile/app`, `apps/mobile/features`
and `apps/web`. Each row is a capability a buyer could notice.

### Group layer — what one group already gives you

| Capability | Where it lives |
| --- | --- |
| Chat channels per group, pinned channels, threads, reactions, polls, typing, read state, mentions, link previews, image/file attachments | `functions/messaging/*`, `features/chat` |
| Events: create, series, RSVP with guests, event chat, invites, reminders, shareable event pages | `functions/meetings/*`, `eventSeries.ts`, `eventInvites.ts` |
| Attendance: take, edit, per-event check-in screen, guest counts, history, charts | `functions/meetings/attendance.ts`, `leader-tools/[group_id]/attendance` |
| Leader toolbar (configurable per group, per-tool visibility, custom labels) | `constants/toolbarTools.ts`, `toolbar-settings.tsx` |
| Group resources (documents/links surfaced as tools) | `functions/groupResources`, `leader-tools/[group_id]/resources` |
| Group tasks and task templates | `functions/tasks`, `functions/taskTemplates` |
| Bots: Birthday, Welcome, Followup, Task Reminder, Communication | `functions/groupBots.ts` |
| Follow-up: member follow-up records, configurable scores, custom columns and fields, alerts | `functions/memberFollowups.ts`, `followupScoreComputation.ts` |
| Join requests, leader-approved or admin-approved | `functions/groups/joinRequestReview.ts` |
| Public group page and short links | `(landing)/group/[id]`, `groups.shortId`, `toolShortLinks` |
| Direct messages and inbox, block list, DM requests, rate limits | `functions/messaging/directMessages.ts`, `app/inbox` |
| Prayer: requests, responses, reactions, follow-ups, moderation queue | `functions/prayers*`, gated by `churchFeatures.prayerEnabled` |

### Community layer — the org layer the middle tier sells

| Capability | Where it lives |
| --- | --- |
| Admin dashboard: stats, members, staff, requests, community settings | `app/(user)/you/admin/*`, `functions/admin/*` |
| People tab: directory across all groups, custom fields, saved views, assignees, statuses, alerts | `functions/communityPeople.ts`, `peopleSavedViews.ts` |
| Group types (community-defined taxonomy) and multiple groups | `groupTypes`, `functions/groups` |
| Community-wide events | `functions/communityWideEvents.ts` |
| Admin broadcasts with an approval flow | `functions/adminBroadcasts.ts` |
| Event blasts | `functions/eventBlasts.ts` |
| Shared channels across groups, cross-team channels | `messaging/sharedChannels.ts`, `scheduling/crossTeamChannels.ts` |
| Announcement groups | `groups.isAnnouncementGroup`, ADR-008 |
| Group creation requests (members propose, admins approve) | `functions/groupCreationRequests.ts` |
| Community landing page — public "gold card" intake form at `/c/[slug]` with custom fields | `functions/communityLandingPage*.ts` |
| Branding: name, logo, app icon, primary/secondary colors, subdomain | `communities` fields, `admin/settings.ts` |
| Discovery: explore, near-me map, community and group search, public listing | `features/explore`, `features/nearme`, `groupSearch.ts` |
| Duplicate account detection and merge | `functions/admin/duplicates.ts` |
| Attendance CSV export, per-group-type export | `admin/cleanup.ts`, `admin/stats.ts` |
| Stats: total attendance, new signups, active members, attendance by group type, daily summary, notification stats | `functions/admin/stats.ts` |
| Public HTTP API (attendance read) with community-scoped API keys | `functions/publicApi.ts`, `admin/apiKeys.ts` |
| Integrations: Planning Center (people, services, auto-channels, run sheets, serving counts), Clearstream SMS, Flodesk email, Slack service bot | `functions/integrations.ts`, `pcoServices/*`, `marketing/*`, `slackServiceBot/*` |
| Notifications: push (Expo), SMS (Twilio), email (Resend), per-user preferences, rollups | `functions/notifications/*` |
| Demo mode and self-serve go-live | `functions/demo.ts`, `app/onboarding/*` |
| Posters: curated event cover library (platform-curated, global) | `functions/posters.ts` |

### Service-planning layer — the Planning Center Services replacement

| Capability | Where it lives |
| --- | --- |
| Rostering hub: teams, team roles, team managers | `functions/scheduling/teams.ts`, `roles.ts`, ADR-024/025 |
| Event plans, needed roles, role assignments, assignment requests | `scheduling/assignments.ts`, `eventPlans` |
| Availability collection, availability requests, public availability | `scheduling/availability.ts`, `publicAvailability.ts` |
| Native run sheets, run-sheet templates, rehearse mode | `scheduling/runSheetTemplates.ts`, ADR-026 |
| Song library and worship media | `functions/scheduling/songs.ts`, ADR-027 |
| Event tasks, task templates, shared task completions, how-to doc checks | `scheduling/eventTasks.ts`, `taskTemplates.ts` |
| Personal serving tasks, my schedule, serving tabs | `personalServingTasks`, `mySchedule.ts` |
| Plan templates and quick start | `planTemplates.ts`, `quickStart.ts` |

### Money layer

| Capability | Where it lives |
| --- | --- |
| Donations (one-off and recurring) on the community's connected Stripe account, ledger, receipts | `functions/finance/giving.ts`, ADR-032 |
| Fund transparency screen for members | `finance/giving.ts` `getFundOverview` |
| Cards, card provider connections, expenses, finance roles | `functions/finance/*` |
| Subscription billing, sales-tax pass-through | `functions/ee/billing.ts`, the billing ADRs (030/031, under `docs/architecture/decisions/`) |

### Platform / self-host

| Capability | Notes |
| --- | --- |
| AGPL-3.0 core, `/ee` under Elastic License 2.0 | Open-core split already exists; `/ee` holds billing, deployment, infra |
| Self-hosting | Advertised as free forever in the pricing guide |

## 4. Proposed matrix

`●` included · `◐` limited · `○` not included · `✚` does not exist yet (§6)

| Capability | Free | Community | Enterprise |
| --- | :-: | :-: | :-: |
| **Scale** | | | |
| Communities | 1 | 1 | 1 campus-wide, or ✚ many under a rollup |
| Groups per community | ◐ cap (§5) | ● unlimited | ● unlimited |
| Active members | ◐ cap (§5) | ● metered, banded, capped | ● contracted |
| **Group layer** | | | |
| Chat, channels, threads, reactions, polls | ● | ● | ● |
| Events, series, RSVP, guests, event chat | ● | ● | ● |
| Attendance and check-in | ● | ● | ● |
| Leader toolbar, resources, group tasks | ● | ● | ● |
| Bots (birthday, welcome, followup, task, communication) | ◐ birthday + welcome | ● all | ● all |
| Follow-up scoring, custom columns, alerts | ○ | ● | ● |
| Direct messages and inbox | ● | ● | ● |
| Prayer | ● where enabled | ● | ● |
| **Community layer** | | | |
| Admin dashboard and stats | ◐ basic counts | ● | ● |
| People directory, custom fields, saved views | ○ | ● | ● |
| Group types | ○ single default | ● | ● |
| Community-wide events, admin broadcasts, event blasts | ○ | ● | ● |
| Shared channels, announcement groups | ○ | ● | ● |
| Group creation requests | ○ | ● | ● |
| Community landing page / intake form | ○ | ● | ● |
| Branding: logo and colors | ◐ logo only | ● | ● custom app icon and subdomain |
| Discovery: explore, near-me, public listing | ● | ● | ● |
| Attendance CSV export | ○ | ● | ● |
| Public API and API keys | ○ | ◐ read | ● |
| Integrations: PCO, Clearstream, Flodesk, Slack | ○ | ● | ● |
| Roster import as migration ramp | ○ | ● | ● |
| **Service planning** | | | |
| Teams, roles, assignments, availability | ○ | ● | ● |
| Run sheets, templates, song library | ○ | ● | ● |
| **Money** | | | |
| Donations, ledger, receipts, fund transparency | ○ | ● | ● |
| Cards and expenses | ○ | ● | ● |
| **Institutional** | | | |
| SSO | ○ | ○ | ✚ |
| Retention and cohort analytics | ○ | ○ | ✚ |
| Content visibility with disclosure (Slack model, DMs never visible) | ○ | ○ | ✚ |
| Cross-community rollup and reporting | ○ | ○ | ✚ |
| Audit log and compliance export | ○ | ○ | ✚ |
| Annual contract, invoicing, procurement | ○ | ○ | ● process, not product |

## 5. The boundary decisions

**The line that sells the middle tier is seeing across groups.** One leader
running one group never pays. The moment someone needs a directory, a
cross-group event, a broadcast, or a roll-up number, they are buying Community.
Almost every `○` in the Free column above is a cross-group capability, which is
why the boundary holds without crippling the free product.

**Free tier group count.** The open question from the thread. Recommendation:
**3 groups with a member cap, not 1 and not 5.**

- 1 group is defensible on the data model but reads as a demo. A club officer
  hits the wall on day two when they want a leaders channel.
- 5 groups with no member cap is a free Community tier for a small church, and
  churches are the tier we are trying to charge.
- 3 groups plus a cap (suggested: **50 billable active members per community**)
  lets a real club run properly, and the cap — not the group count — is what
  stops a 200-person church living on Free. Cap on members, gate on cross-group
  features; the group count is then almost cosmetic.

**Enterprise.** Institutional buying, not more product. SSO and compliance are
the honest gates; everything else in Enterprise is Community plus a contract.

**What Free must keep.** Chat, events, RSVP, attendance, DMs, discovery. Free is
the acquisition engine; the daily-use loop is the whole reason members open the
app, and it is what campus portals and church tools do not have. Do not degrade
it.

## 6. Gaps between the pitch and the product

Everything marked `✚` is a build, not a toggle. Sales conversations should not
imply otherwise.

| Promised | Reality |
| --- | --- |
| SSO | Auth is phone OTP + email OTP + account claim (`@convex-dev/auth`). No SAML, no OIDC, no directory sync. Universities will ask for this first. |
| Retention analytics | Stats gives attendance, new signups, active members, notification stats. No cohorts, no retention curves, no engagement over time. |
| Content visibility on the Slack model | Nothing exists. Needs the disclosure UI, an admin surface, an audit trail, and a hard exclusion for DMs. |
| Diocese / church-network rollup | No entity above `communities`. Multi-community reporting is a new data model. |
| Full Planning Center replacement | Services ✔ (teams, roles, availability, run sheets, songs), People ✔, Groups ✔ and better (real chat), Giving ✔. **Children's check-in ✘** — the check-in screen is event attendance, not kids' check-in with guardians, labels, and security codes. Calendar/room booking ✘, Publishing ✘. |
| Roster import as the migration ramp | PCO people sync exists. Generic CSV roster import does not. |

## 7. What a tiered product needs that we do not have

1. **A plan on the community.** `communities.plan: "free" | "community" | "enterprise"`, plus the entitlement values that go with it (group cap, member cap).
2. **One resolver, not inline checks.** A single `lib/entitlements.ts` exposing `has<Capability>` / `require<Capability>`, with every call site using the `require` form. The failure mode to avoid is fifty scattered `if (plan === "free")` checks; when the answer today is "everyone gets this," the resolver still gets written and its body just returns true.
3. **Enforcement at write time, not render time.** Hiding a button is not a limit. Group creation, member join, and every gated mutation need the server check.
4. **A path when a limit is hit.** What happens to group #4, or active member #51? Blocking a join is hostile; the usual answer is to block creation but never break existing data.
5. **Billing that matches the story.** Banded, declining, capped pricing is a different Stripe shape than today's flat `quantity × $1`. The 28th-sync / 1st-charge machinery (ADR-030) and the preview email survive; the price object does not.
6. **Free-tier abuse limits.** Free communities are a new spam surface: rate limits, discovery rules, and a story for abandoned communities.

## 8. Conflicts with what we have already published

`apps/web/src/pages/guides/Pricing.tsx` is live and makes three promises that
tiering breaks:

- *"There are no tiers, no seat packs to buy, and no per-feature upsells."*
- *"$1 per active member is beta pricing… churches who start now lock in $1/member for as long as they keep their subscription."*
- *"Test it out for $1"* — the church-of-one entry point, which the Free tier replaces.

Two consequences. **The lock-in promise has to be honored** — existing
subscribers grandfathered at $1/member, explicitly, in writing. And the pricing
guide must be rewritten in the same PR that reprices, not after; per
`CLAUDE.md`, a change to documented user-facing behavior updates its guide in
the same PR.

**A sizing note that changes the middle-tier argument.** At $1/active member, a
church with 75–400 active members already pays $75–400/month, which brackets the
proposed $99–249 Community band. The repricing is therefore not a 5–20×
increase for the target customer — it is a **floor** (small churches pay more
than $75) and a **cap** (large churches stop scaling past the band). The cap
matters more than the floor: today a 1,000-member church with ~300 active
members pays ~$300/month, which is *above* Planning Center's ~$250 unlimited
ceiling. Uncapped per-member pricing loses the head-to-head at exactly the size
where the deal is worth winning.

## 9. Sequence

1. **Now** — agree the matrix. Decide the Free group cap and member cap. Instrument the signup funnel. Grandfather existing subscribers in writing.
2. **Next** — build the plan field, the entitlement resolver, and server-side enforcement. Reprice Community with banded, capped billing. Rewrite the pricing guide in the same PR.
3. **Then** — launch Free. Free is the acquisition engine, so it ships after enforcement exists, not before.
4. **2027** — one campus pilot. SSO and content visibility are prerequisites for university sales, and both are builds; scope them before the pilot conversations, not during.

## 10. Open questions

- Free tier: 3 groups + 50 active members, or a different pair?
- Does the Free tier get a community landing page? It is the best viral surface we have, and it is also a Community-tier selling point.
- Giving on Free: a run club that collects dues is a real use case, and donations run on the community's own Stripe account so it costs us nothing per transaction.
- Do we ever meter Enterprise on active members, or is it purely contracted?
- Children's check-in: build it, or stop saying "full Planning Center replacement"?
