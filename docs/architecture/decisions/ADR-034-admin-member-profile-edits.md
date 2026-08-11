# ADR-034: Admin Member Profile Edits with an Audit Trail

## Status

Accepted (2026-08). Implemented.

## Context

Community members are frequently entered into Togather by someone else — most
often an admin typing up a paper connect card (the "Gold Card") after a service,
or a leader pre-creating a placeholder row through the assign-from-community
invite flow. Data captured that way contains mistakes: a transposed digit in a
phone number, a misspelled first name, a wrong email domain.

Until now there was no way to fix it. A member could edit their own profile
(`users.update`), but an admin looking at a member's detail page could only
change roles or remove the person from the community. The workaround was to
delete and re-enter the person, which loses their group memberships and
attendance history.

The obvious fix — let admins edit member records — carries two risks worth
naming:

1. **Account takeover.** Phone and email are credentials, not just data. A
   phone receives sign-in OTPs, and an email is enough on its own: the
   unauthenticated account-claim flow (`auth/accountClaim.ts`) looks a user up
   by whatever address is on the record, mails a code there, and
   `verify_and_link` links an arbitrary phone and returns access and refresh
   tokens. Either field, in the wrong hands, is a full takeover — and since
   both live on the global `users` row while admin roles are per-community, the
   takeover reaches into communities the acting admin has no authority over.
2. **Silent data drift.** Once several admins can change each other's members'
   data, "who changed Rafael's number, and why?" becomes unanswerable.

### Alternatives Considered

1. **Reuse `users.update` with an admin branch** — the self-service mutation
   has no notion of a community or an acting admin, so every guard would be
   bolted on.
2. **A generic `auditLogs` table for all admin actions** — broader than the
   problem in front of us, and it would need a discriminated payload before it
   had a second caller. The codebase already prefers domain-scoped audit tables
   over one universal log: `financeAuditEvents` (ADR-032 §4) covers the finance
   control plane and nothing else. This follows that precedent rather than
   inventing a competing general mechanism.
3. **Audit rows per changed field** — simpler shape, but an edit that fixes a
   name and a phone together reads as two unrelated events in the UI.

## Decision

Add a dedicated admin mutation, `admin.members.updateMemberProfile`, that edits
`firstName`, `lastName`, `email`, `phone` and `dateOfBirth`, and writes one
`memberProfileAudits` row per edit containing every field that actually changed.

### Audit Record

One row per edit (not per field), so the UI can render "Reg Admin changed First
name and Phone on 10 Aug" as a single event:

```ts
memberProfileAudits: {
  communityId, targetUserId, actorUserId,
  changes: [{ field, previousValue, newValue }],
  reason?, createdAt,
}
```

The trail is append-only and readable only by community admins, via
`admin.members.listMemberProfileAudits` (cursor-paginated, so it stays fully
reachable however long it gets). The single exception to append-only is
`mergeDuplicateAccounts`, which re-keys `targetUserId` onto the surviving
primary so a merged member's history follows the person rather than being
stranded on a deactivated row.

### Key Rules

The decisive rule is that **contact details are only editable while nobody has
claimed the account.** An unclaimed record is not yet anyone's identity — it is
data an admin typed off a card, which is exactly what this feature is for. Once
someone has signed in as the account it is theirs, and the fields that would let
another person sign in as them are closed to admins entirely. That is a narrower
rule than gating on roles, and it needs no cross-community reasoning to be safe.

"Claimed" is deliberately broader than `phoneVerified`, because that flag alone
does not mean what it appears to: `auth/login.ts` `legacyLogin` authenticates a
migrated password holder and issues real tokens without ever setting it. The
account counts as claimed if **any** ownership signal is present:

1. `users.phoneVerified`
2. `users.password` (legacy migrated accounts)
3. `users.lastLogin`
4. `userCommunities.lastLogin` — current sign-in paths stamp the *membership*
   row, not the user row, so the user-row check alone misses almost everyone.

The rules in full:

1. **Admins edit members.** Community admin role required, as with every other
   admin mutation, and the target's membership must be **status 1 (active)**.
   Status 2 (left) and status 3 (blocked) rows are retained in People search, so
   rejecting only status 3 would let a community keep editing the global record
   of someone who had left.
2. **Phone and email are editable only on an unclaimed account.** Otherwise
   nobody may change them here; the member changes their own, through a flow
   that proves ownership.
3. **...and only when the account holds no authority anywhere.** All the
   authority-bearing surfaces are enumerated in one function,
   `describeAccountAuthority`, because a missed one silently reopens the
   takeover path — **a feature that adds a new kind of role must add it there.**
4. **Names and date of birth are not credentials**, so they follow the ordinary
   role rules and stay correctable even on a claimed account.
5. **Editing another admin's record requires Primary Admin**, mirroring
   `updateMemberRole`. Editing your own is always allowed, since self-service
   profile settings already permit it.
6. **Changing a phone number leaves `phoneVerified` false.** An admin typing a
   number is not proof the member owns it.
7. **Phone and email must stay unique** across users — both are sign-in
   identifiers, so a duplicate makes the account ambiguous.
8. **First name cannot be cleared, and an existing phone cannot be removed.**
   Members without a phone at all are common in migrated data, so a profile edit
   never requires inventing one; but removing an existing number would lock the
   member out of sign-in. Email and date of birth can be cleared.
9. **No-op edits write nothing**, including no audit row. A reason alone is not
   an edit.
10. **A free-text reason is optional** (max 500 characters) and stored with the
    edit.

### Why an unclaimed account can still be powerful

Rule 3 is not redundant with rule 2. An unclaimed record can carry real
authority:

- Legacy accounts were migrated with their roles intact and have never signed in.
- Leaders are routinely entered before they first sign in — they are exactly the
  population this feature serves.
- A **placeholder** row (`users.isPlaceholder`) keeps a stable `_id` precisely so
  that existing `roleAssignments` / `groupMembers` / `userCommunities` rows
  transparently belong to the account once claimed (`auth/registration.ts`). A
  placeholder is unclaimed by definition and can already hold roles.

So unclaimed-ness never short-circuits the authority check; both run.

### The enumerated authority surfaces

`describeAccountAuthority` currently covers ten, each verified against a real
call site that grants a capability:

| Surface | Grants |
| --- | --- |
| `users.isSuperuser` | Full platform access; bypasses every `platformRoles` check |
| `users.isStaff` | Equivalent to superuser everywhere it is tested |
| `users.platformRoles[]` | `poster_admin` (`posters.ts`), `dev_maintainer` (`devAssistant/access.ts`) |
| `users.roles >= 3` (**global**) | `messaging/flagging.ts` `isUserAdmin` — cross-community flag review and message moderation, with no membership behind it |
| `userCommunities` roles >= 3, status 1 | Community admin / primary admin |
| `communityFinanceRoles` | Community finance admin (ADR-033) |
| `groupMembers` role `leader`, active, non-archived group | Group leadership (`requireGroupLeaderOrCommunityAdmin`) |
| `fundRoles`, `revokedAt` unset | Fund finance roles (ADR-032) |
| `teamManagers` + still an active group member | Serving-team roster authority (ADR-025) |
| `chatChannelMembers` role owner/admin/moderator, active | Delete others' messages, change channel roles, remove members |

Two of these need care rather than a plain row lookup, and both are tested:

- **Stale rows must not count.** An admin role in a community the member has
  *left* (status 2) confers nothing, a `revokedAt` fund role confers nothing,
  and leading an *archived* group confers nothing. Locking a member's contact
  details on a dead role would be a permanent, unexplainable block.
- **`teamManagers` rows are never cleaned up on exit**, so `isTeamManager`
  re-verifies active group membership on every check. The guard mirrors that;
  the row alone is not authority.

## Consequences

**Positive**

- Bad data captured on someone's behalf is fixable without losing history.
- Every change has an attributable actor, timestamp and before/after value.
- Both takeover paths — sign-in OTP and account claim — are closed on any
  account a person has actually claimed, without needing to reason about roles
  in other communities.

### Known limitation — the enumeration is the boundary

The safety of admin-written contact details rests on an enumeration of every
table that grants authority, and that enumeration is only correct as of today.
Nothing in the type system will flag the eleventh surface.

This is a sharper risk here than it looks. Porting this design onto the current
codebase found **ten** surfaces where an earlier version of it had four — the
extra six (superuser, staff, platform roles, community finance roles, fund
roles, team managers) all postdate that design. The codebase is actively growing
authority surfaces, so the list should be read as a floor, not a ceiling.

One surface is knowingly **not** covered: `meetings.hostUserIds` grants edit and
cancel rights over a meeting (`lib/meetingPermissions.ts` `isMeetingHost`), but
Convex cannot index array-contains, so "which meetings does this user host?" has
no efficient answer. Checking it would mean scanning `meetings` on every profile
edit. It is excluded deliberately, and recorded here rather than left implied.

The structural fix is to stop relying on the enumeration: require the
*recipient* of a new phone or email to verify it before the change takes effect,
so an admin-written contact detail is never on its own sufficient to claim an
account. That reduces this rule from a security boundary to a UX nicety. It is
deliberately out of scope here, and worth doing before the surface grows further.

**Negative**

- The audit table grows unbounded; there is no retention policy yet. Volume is
  low (admin corrections, not member self-service), so this is acceptable for now.
- An admin cannot fix a typo in a claimed member's email, even a harmless one.
  The member does it themselves; the alternative is leaving a takeover path open.
- An unclaimed leader with a mistyped number is stuck: they cannot sign in to fix
  it, and admins cannot fix it for them. The escape is to remove the leadership
  role, correct the number, then restore the role — deliberately awkward, because
  the alternative is letting any admin claim a leader's account. This bites the
  feature's own use case hardest, since leaders are exactly the people entered
  before they first sign in. If it proves common in practice, the verification
  flow above is the right answer, not a looser guard.
- On an unclaimed account, an admin can still set the contact details and then
  claim it. That is inherent to entering people on their behalf — the record
  holds only what admins typed — and the audit trail names who did it.
- Members are not notified when an admin edits their profile. If that becomes
  desirable, the audit row is the natural trigger.

### Side effects and adjacent fixes

- `searchText` is rebuilt whenever a name, email or phone changes, so the member
  stays findable by their corrected details.
- Renames schedule `syncUserProfileToChannels`, which refreshes the denormalized
  display name held in `chatChannelMembers`.
- **`registerNewUser` now persists `phoneVerified`.** Its existing-user and
  create-race branches both issued real tokens off a verified phone and reported
  `phoneVerified: true` while never writing it. The response claimed a state the
  database did not have; this guard was simply the first consumer to notice.
  Fixed at the source rather than by adding a fifth ownership signal.

### Offline support

Not offline-capable, per the ADR-028 rubric. This is an admin desk workflow with
connectivity, and every write is server-authorized against role and claim state,
so a queued offline edit could not know whether it would be accepted. Read
caching would likewise be misleading: `canEditProfile` is a live permission
answer, not content.

### Dates

`dateOfBirth` is stored as **UTC midnight** of the calendar day — the convention
`auth/helpers.parseAndValidateDate` established via `new Date("YYYY-MM-DD")` —
while the shared `DatePicker` deals in **local wall-clock** Dates on both
platforms. The mutation therefore speaks in `YYYY-MM-DD` strings rather than
timestamps: a calendar date has no timezone, so there is nothing for client and
server to disagree about. The client-side converters read UTC getters for the
stored value and local getters for the picker value, and deliberately do *not*
branch on `Platform.OS` — the picker's web and native values mean the same
thing, and a platform branch is how the equivalent conversion in `StatsContent`
silently became an off-by-one (fixed alongside this work).

## Implementation

| Area | Location |
| --- | --- |
| Schema | `apps/convex/schema.ts` (`memberProfileAudits`) |
| Backend | `apps/convex/functions/admin/members.ts` |
| Merge re-key | `apps/convex/functions/admin/duplicates.ts` |
| Auth fix | `apps/convex/functions/auth/registration.ts` |
| Backend tests | `apps/convex/__tests__/admin-member-profile-edit.test.ts` |
| UI — edit form | `apps/mobile/features/admin/components/EditMemberProfileModal.tsx` |
| UI — entry point and history | `apps/mobile/features/admin/components/PersonDetailScreen.tsx` |
| UI tests | `apps/mobile/features/admin/__tests__/EditMemberProfileModal.test.tsx` |
