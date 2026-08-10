# ADR-024: Rostering Hub — Untangling Channel Creation from Team Scheduling

> **Terminology.** Inherits ADR-023's vocabulary. **Event** = a community event
> on the Events tab (`meetings`). **Event Plan** = a dated thing volunteers are
> rostered to (`eventPlans`). A **serving team** (or just **team**) is a
> `chatChannels` row with `isServingTeam: true`; it has **roles**, not
> "positions". No "service" language user-facing. This ADR adds one term:
> **Rostering hub** — the per-group home for everything scheduling-related.

## Status
Accepted

## Date
2026-05-22

## Context

The "Create Channel" screen (`apps/mobile/app/inbox/[groupId]/create.tsx`)
offers four "channel types": **Custom**, **Event Team**, **Planning Center**,
**Cross-team channel**. In practice this picker conflates two orthogonal
concepts:

- **Custom** is a *communication* primitive — "I want a chat room."
- **Event Team / Planning Center / Cross-team** are *scheduling* primitives —
  roster-driven things that happen to *produce* a chat channel.

The consequences are visible in the UI today (see the Create Channel
screenshots that prompted this ADR):

1. A user who just wants a chat channel is forced to reason about three
   scheduling options they don't need.
2. A leader who wants to set up a serving team must mentally model "the channel
   **is** the team", go through a *channel* flow, and then get bounced to a
   buried route (`/rostering/[groupId]/team/[channelId]`) to actually configure
   roles.
3. **Serving teams have no home.** `/rostering/[groupId]` renders only a flat
   list of *event plans* (`EventListScreen`). Teams exist only as a side-effect
   of channel creation. There is no "teams" view anywhere.
4. The three "scheduling" options aren't even the same kind of thing:
   - **Event Team** — a native serving team that owns roles + event plans.
   - **Planning Center** — a team whose roster lives in PCO.
   - **Cross-team channel** — *not a team at all*; an aggregator channel with no
     roster of its own, deriving membership from other teams' assignments.

Separately, Togather now has **two** scheduling systems that must coexist: the
read-only **Planning Center** integration (`pcoServices/`) and the **native
rostering** engine from ADR-023. There is no UI surface that presents them
coherently.

## Decision

Make **Team** a first-class entity, surfaced in a restructured **Rostering
hub**. Revert "Create Channel" to Custom-only. This is a navigation/UX
reorganization — **no schema changes are required** (a team's schedule source
is already encoded by `isServingTeam` vs `channelType === "pco_services"`).

### 1. "Create Channel" becomes Custom-only

The Channel Type segmented control is removed from
`/inbox/[groupId]/create`. The screen creates a **Custom** channel directly
(name, description, join mode). The `CrossTeamSelectorPicker` and
`PcoAutoChannelConfig` components are not deleted — they move into the Rostering
hub (below).

### 2. `/rostering/[groupId]` becomes a hub with three views

Today's single `EventListScreen` is replaced by a hub with three segments:

| View           | Contents                                                        | Create affordance              |
| -------------- | --------------------------------------------------------------- | ------------------------------ |
| **Teams**      | Serving teams in the group, each badged by schedule source      | **+ New team**                 |
| **Schedule**   | Unified event-plan timeline across all the group's teams        | **+ New event plan**           |
| **Cross-team** | Aggregator channels that draw from teams                        | **+ New cross-team channel**   |

The **Schedule** view is today's `EventListScreen`, unchanged in function. The
**Teams** and **Cross-team** views are new.

The hub opens on **Schedule** by default — it is the most time-sensitive view,
and existing deep links to `/rostering/[groupId]` keep landing on the same
content. The three views are switched via a **JS-only, route-backed top tab
bar**: each view is a real route (`/rostering/[id]`, `/teams`, `/cross-team`)
and the tab bar is a shared component that navigates between them with an
active-underline indicator. Material top-tabs (`@react-navigation`) was
rejected because it requires the native `react-native-pager-view` dependency,
which collides with the OTA / native-dep policy in ADR-013. The trade-off is no
swipe-between-tabs gesture — acceptable. The hub keeps the name **"Rostering"**
— already used by the route and the Group Actions menu item.

```
GROUP detail
├── Channels  (ChannelsSection)
│     └── + Create Channel ──▶ /inbox/[groupId]/create        (Custom only)
│
└── Rostering  (RosteringSection · Group Actions menu)
      └── /rostering/[groupId]  ──────── HUB ────────┐
                                                     │
          ┌──────────────┬───────────────────────────┴───────────┐
          ▼              ▼                                        ▼
       Teams          Schedule                               Cross-team
   (serving teams)  (event plans, all teams)            (aggregator channels)
          │              │                                        │
    + New team     + New event plan                  + New cross-team channel
          │              │
          ▼              ▼
  /rostering/[groupId]/team/[channelId]     /rostering/[groupId]/event/[planId]
    Team detail: roles · upcoming             Event plan editor
    plans · members · open chat
```

### 3. Team as a first-class entity

A **Team** has a name, roles, a synced member roster, a **chat channel** (an
*attribute*, not the identity), and a **schedule source**. The route
`/rostering/[groupId]/team/[channelId]` is promoted from "TeamSetupScreen" to a
full **Team detail** screen:

- Header — team name, **source badge** (Native / Planning Center), member count.
- **Roles** — today's `TeamSetupScreen` role management.
- **Upcoming event plans** for this team.
- **Members** — the synced roster (read-only; derived per ADR-023).
- **Open chat** — an affordance into the team's `chatChannels` row.
- Settings (archive, etc.).

The chat channel still appears in the inbox `ChannelsSection` list — that is
where members *chat*. The Rostering hub is where leaders *manage the roster*.
The same channel reachable from two places is intentional and matches how a
team is genuinely both a conversation and a roster.

### 4. Team creation flow

**+ New team** in the Teams view opens a create-team flow:

1. Name + optional description.
2. **Schedule source**: **Native** (default) or **Planning Center** (shown only
   to community admins, and only when the community has PCO connected).
3. **Native** → on create, continue to role setup (the existing starter-roles
   flow from ADR-023).
4. **Planning Center** → the existing `PcoAutoChannelConfig` flow.

Backend: native teams keep the `createCustomChannel` (`addCreatorAsMember:
false`) + `markChannelAsTeam` path; PCO teams keep `createAutoChannel`. A thin
`createServingTeam` wrapper may be added for clarity but is an implementation
detail, not a requirement of this ADR.

Permission gates are unchanged: native team creation = group leader; PCO team
creation = community admin.

### 5. Cross-team channels live in their own hub view

Cross-team channels are **not teams** — they have no roster of their own, they
*aggregate* membership from teams' role assignments. They get the **Cross-team**
view in the hub. This placement also makes their dependency explicit: a
cross-team channel can only be built once teams exist.

Backend (`createCrossTeamChannel` / `updateCrossTeamChannel`,
`crossTeamChannels.ts`) is unchanged. The `CrossTeamSelectorPicker` moves
verbatim from `create.tsx` into the new Cross-team view. This view is also the
natural home for the **edit** affordance that PR #397 left API-only.

### 6. Planning Center ↔ native coexistence

Per the chosen product direction — *native rostering is the destination, but
PCO stays comfortably usable with no forced migration* — coexistence works like
this:

- **Schedule source is per-team and never mixed.** A team is *either* Native
  *or* Planning Center. A half-and-half team would mean two systems of record
  fighting over `roleAssignments`; it is explicitly disallowed.
- **The Teams view shows both, side by side, each source-badged.** A community
  migrates team-by-team; a mixed list is a normal, indefinite state.
- **The Schedule view is the unified surface.** It merges event plans from
  every team into one timeline. Native rows are editable; PCO-sourced rows are
  **read-only and badged "Synced from Planning Center"**. The data models stay
  separate — only the *view* is unified.
- **A PCO team's detail screen is read-only** ("Synced from Planning Center")
  and offers — but never forces — a **"Switch to native scheduling"** action.
  That action is the importer described in ADR-023 Phase 2
  (`pcoPlanId` / `pcoAssignmentId` carry the linkage); it is out of scope for
  this ADR's UI work beyond providing the entry point.
- **No degradation of PCO.** No deprecation nags, no removed functionality. The
  `pco-auto-channel-rotation` cron and Run Sheet keep working unchanged. PCO
  retires per-community, only once that community has migrated every team.

## What moves where

| Today                                          | After this ADR                                          |
| ---------------------------------------------- | ------------------------------------------------------- |
| Create Channel → Custom                        | Create Channel → Custom *(unchanged)*                   |
| Create Channel → Event Team                    | Rostering → Teams → **+ New team** (Native)             |
| Create Channel → Planning Center               | Rostering → Teams → **+ New team** (Planning Center)    |
| Create Channel → Cross-team channel            | Rostering → Cross-team → **+ New cross-team channel**   |
| `/rostering/[groupId]` = `EventListScreen`     | `/rostering/[groupId]` = hub (Teams / Schedule / Cross) |
| `/rostering/.../team/[id]` = `TeamSetupScreen` | same route = **Team detail** (roles + plans + members)  |

## Migration & backward compatibility

- **No data migration.** Existing `isServingTeam` channels appear in the Teams
  view as Native teams; existing `pco_services` channels appear as Planning
  Center teams; existing cross-team channels appear in the Cross-team view.
- **No schema changes.** Schedule source is already derivable from existing
  fields.
- Existing deep links to `/rostering/[groupId]` resolve to the hub (Schedule
  view).
- The "convert an existing custom channel to a serving team" affordance on
  `ChannelInfoScreen` is **removed** — teams are created only through the
  Rostering hub. `markChannelAsTeam` is retained solely as the internal backend
  primitive the create-team flow calls; it is no longer reachable from the UI.

## Phasing

- **Phase A — Hub shell.** Build the Rostering hub with Teams / Schedule /
  Cross-team views, the Teams list, and the expanded Team detail screen. Move
  the cross-team picker into the Cross-team view. "Create Channel" untouched.
- **Phase B — Untangle creation.** Remove Event Team / Planning Center /
  Cross-team from the Create Channel picker; route all creation through the hub.
- **Phase C — PCO coexistence polish.** Source badges, the unified Schedule
  timeline with read-only PCO rows, and the "Switch to native scheduling" entry
  point. (The importer itself is ADR-023 Phase 2.)

## Consequences

- "Create Channel" becomes a one-purpose screen — most users only ever see
  Custom.
- Serving teams gain a real home; discoverability improves substantially.
- Cross-team's dependency on teams becomes legible in the information
  architecture.
- One extra level of navigation depth inside Rostering (hub → view → detail).
- Team channels appear in *both* the inbox channel list and the Rostering Teams
  view — intentional, but worth validating with users.
- Two new screens to build (Teams list, expanded Team detail) plus a hub
  shell; the Schedule view and all backend mutations are reused as-is.

## Resolved decisions

1. **Default view** — the hub opens on **Schedule**, the most time-sensitive
   view; existing deep links keep landing on the same content.
2. **Hub name** — stays **"Rostering"**, already used by the route and the
   Group Actions menu item.
3. **Inbox channel list** — serving-team channels **remain listed** in the
   inbox `ChannelsSection`; that is where their chat happens. The Rostering hub
   is where their roster is managed.
4. **No channel conversion** — the "convert an existing custom channel to a
   serving team" path on `ChannelInfoScreen` is **removed entirely**. Teams are
   created only through the Rostering hub. (`markChannelAsTeam` survives only as
   an internal backend primitive.)
5. **View switcher** — a **JS-only, route-backed top tab bar** (each view is a
   real route; a shared tab-bar component navigates between them). Material
   top-tabs was rejected: it needs the native `react-native-pager-view` dep,
   which conflicts with the ADR-013 OTA / native-dependency policy. Trade-off:
   no swipe-between-tabs gesture.
