# ADR-027: Native Song Library & Worship Media

> **Terminology.** Follows ADR-023/026. **Event Plan** is the dated rostering
> entity (`eventPlans`); a **run sheet** is the ordered order-of-items for an
> event plan; **run sheet items** are `eventItems`. PCO's product is "PCO
> Services". A **song** here is a library entry in Togather, identified where
> possible by its **CCLI number** (the worship world's universal song ID).

## Status
Accepted

## Date
2026-06-09

## Context

ADR-026 shipped the native run sheet (`eventItems`) and deliberately kept songs
thin — a `songDetails: { key?, bpm?, author? }` blob on each item — explicitly
deferring "Song library / CCLI / chord charts / arrangements" to "ADR-023
Phase 3". Feedback from worship leaders is that this thinness misses the point
of how worship teams actually run: songs are connected via **CCLI** and
**multitracks** to Planning Center, which surfaces title/key/BPM/arrangement for
the worship leader and audio engineers, and lets each musician open a song and
rehearse *their specific part* from its multitrack stems. The run sheet's "song"
row is the tip of a music workflow, not a label.

The product goal (per the maintainer) is to **stop depending on Planning Center
for anything** — including this. The critical reframe, confirmed by research
(see "Licensing reality" below), is that **the music content was never PCO's to
begin with**. PCO is an aggregator: it holds its *own* CCLI SongSelect Partner
API agreement and a MultiTracks account-link integration, and surfaces what the
*church's own* CCLI/MultiTracks subscriptions entitle it to. The songs,
copyrighted charts, and multitrack stems originate at **CCLI** and
**MultiTracks.com**, not Planning Center.

### Licensing reality (why this shapes the design)

Research into the CCLI and MultiTracks integration landscape (2025–2026)
established three load-bearing facts:

1. **Automated CCLI content requires two separate relationships, both
   mandatory:** (a) a **vendor-held** CCLI SongSelect Partner API agreement
   (Togather's own subscription key on every request — NDA-bound,
   community-reported ~$1k/yr, and *possibly closed to new partners*), and
   (b) the **church's own** SongSelect subscription connected via OAuth, which
   governs which content may be surfaced. A church's license alone does **not**
   grant a third party API access — you cannot "ride on the user's license" to
   pull content programmatically.
2. **MultiTracks has no open API or partner program.** All integrations (PCO,
   ProPresenter) are privately negotiated. Stem audio is **never re-hosted** —
   it stays in MultiTracks' player and requires the user's MultiTracks
   subscription. "RehearsalMix" (the per-part rehearsal product) is delivered
   only inside MultiTracks' own surfaces and host integrations.
3. **The church already holds the rights.** A church with a CCLI Copyright
   License + SongSelect subscription + Streaming Plus (or MultiTracks' Church
   Streaming License) is licensed to download its own charts and use its own
   purchased stems. Letting *them* import content *they* are licensed for keeps
   the legal burden on the license holder and needs **no vendor agreement at
   all**. This "bring-your-own" model is dramatically cheaper, faster, and
   legally cleaner than an official API integration.

**Consequence for "PCO independence":** a native song library plus
bring-your-own media achieves the goal **completely** — none of it needs PCO.
The only thing we cannot *natively own* is automated, always-fresh CCLI/​
MultiTracks content, and that is not a PCO dependency: it is the church's own
licensed content, brought in by the church.

## Decision

Add a **native, per-community song library** and let run sheet song items
reference it, plus **bring-your-own** charts and multitrack links so musicians
can rehearse. No CCLI/MultiTracks API integration; no re-hosting of copyrighted
stems. The official-API path is documented but deferred indefinitely (Phase 3),
gated on a business agreement rather than engineering.

### Data model: a new `songs` table, referenced by `eventItems`

A song lives once in the community's library and is referenced by run sheet
items, so editing a song's charts/metadata updates every plan that uses it (no
copied-string drift — the same principle ADR-026 applied to role assignments).

```ts
songs: defineTable({
  communityId: v.id("communities"),
  title: v.string(),
  author: v.optional(v.string()),
  ccliNumber: v.optional(v.string()),     // universal song ID; the join key
  defaultKey: v.optional(v.string()),
  bpm: v.optional(v.number()),
  meter: v.optional(v.string()),          // e.g. "4/4"
  arrangementName: v.optional(v.string()),
  structure: v.optional(v.array(v.string())), // ["Intro","Verse 1","Chorus",...]
  // --- Bring-your-own media (Phase 2) ---
  // Charts are key-specific in worship; store one file per key. fileKey is the
  // R2 object key from the existing document-upload pipeline (functions/uploads.ts).
  charts: v.optional(v.array(v.object({
    key: v.optional(v.string()),
    label: v.string(),
    fileKey: v.string(),
    mimeType: v.string(),
  }))),
  // A link-out to where the stems live (MultiTracks/Loop Community). We store a
  // URL, never the audio. Audio stays in the provider's ecosystem (licensing).
  multitracksUrl: v.optional(v.string()),
  notes: v.optional(v.string()),
  createdAt: v.number(),
  createdById: v.id("users"),
  updatedAt: v.number(),
})
  .index("by_community", ["communityId"])
  .index("by_community_ccli", ["communityId", "ccliNumber"]),
```

`eventItems` gains an optional link to the library:

```ts
// added to eventItems (ADR-026)
songId: v.optional(v.id("songs")),
```

The existing `eventItems.songDetails` blob is **retained as a per-occurrence
override**, not replaced. A library song carries the *defaults* (default key,
BPM); a run sheet item may override them for a specific service — worship teams
routinely transpose the same song week to week. Display resolves
`item.songDetails.key ?? song.defaultKey` (and likewise BPM). An item with a
`songId` but no `songDetails` simply shows the library defaults. An item with
neither remains a free-typed song row (backwards compatible — nothing migrates).

### CCLI number is the join key, not a foreign integration

`ccliNumber` is stored as a plain string the leader enters (or leaves blank). It
is the stable identity that a *future* Phase-3 CCLI/MultiTracks integration would
match on, but it has **no live dependency** today — it is metadata. This keeps
the universal ID in our data now without coupling us to any external service.

### Bring-your-own media (Phase 2)

- **Charts:** uploaded through the existing R2 document pipeline
  (`functions/uploads.ts` already allows `.pdf`/images) and attached per key on
  the song. The church holds the SongSelect license that lets it download these;
  Togather only stores the church's own file. Copyright lines are the church's
  responsibility and are shown alongside the chart.
- **Multitracks:** a **link-out** field per song (and an optional per-item
  override). We deep-link to the church's MultiTracks/Loop Community song; we do
  **not** embed a player or host audio. Tapping it opens the provider, where the
  musician's own subscription and RehearsalMix live.
- **Musician rehearsal view:** a read-only, per-person view of an event plan's
  run sheet that lists the songs (key, structure, chart to view, multitracks
  link), so a volunteer assigned to a plan can open it and rehearse ahead of
  time. "Solo my part" is **not** rebuilt — that is RehearsalMix, reached via the
  multitracks link. This resolves ADR-026's open question #1 (volunteers seeing
  the run sheet read-only) for the song dimension.

### Permissions reuse existing guards

No new role field. **Editing the song library** (`requireCommunitySongEditor`)
is open to a **community admin or a leader of any group in the community** — the
worship/ministry leader who builds run sheets is a group leader, so the library
isn't admin-gated. A `canManageSongs` query exposes the same check to the client
so it can show/hide edit affordances authoritatively (rather than guessing from
`is_admin`). **Linking a song to a run sheet item** reuses ADR-026's
`requirePlanScheduler`. **Viewing** songs/charts/links in a run sheet requires an
active community member (`requireCommunityMember`); the musician rehearsal view
is available to members assigned to the plan (read-only).

### Backend surface

A small `functions/scheduling/songs.ts` (queries: `listSongs`, `getSong`;
mutations: `createSong`, `updateSong`, `deleteSong`, plus `attachChart` /
`removeChart` building on the existing upload mutations). `eventItems.updateItem`
gains `songId` in its patch. `listItems`/`getEvent` join the referenced song so
the run sheet renders title/charts/links without extra round-trips.

### Frontend surface

- A **song picker** in the run sheet item editor (`RunSheetScreen`): search the
  community library by title/CCLI#, or "create new song". Selecting sets
  `songId`; key/BPM fields become per-service overrides of the song's defaults.
- A **Song Library** management screen (community/leader scope) to add songs,
  edit metadata, upload charts, and paste a multitracks link.
- The **musician rehearsal view**, reachable from a volunteer's plan/run sheet.

## Deliberately out of scope (v1)

- **Official CCLI SongSelect Partner API integration** — deferred to Phase 3,
  gated on a business/NDA agreement that may not be available to new partners.
  Engineering would be moderate (OAuth + sync, like the existing PCO path); the
  blocker is commercial, not technical.
- **Official MultiTracks integration / account-connect / embedded RehearsalMix**
  — no open program exists; deferred indefinitely. We link out only.
- **Re-hosting stem audio or copyrighted charts we don't own** — never; a
  licensing non-starter.
- **Transposition / chord-chart rendering** — we display the church's uploaded
  key-specific files; we do not transpose ChordPro.
- **Cross-community shared/global song catalog** — songs are per-community.

## Consequences

- A church can build its order-of-items **and** its song library entirely in
  Togather, fully independent of Planning Center, including the worship-leader/
  audio-engineer metadata and a path for musicians to rehearse.
- The remaining reliance for charts/stems is on the **church's own** licensed
  files and provider accounts — not on PCO — satisfying the independence goal
  with the cleanest available legal posture.
- `songs` is a child of `communities`; deleting a community cascades to it.
  Deleting a song must null out (`songId`) referencing `eventItems` rather than
  orphan them — the item falls back to its `songDetails`/title.
- The CCLI number is captured now, so a future Phase-3 integration has a join key
  to match on without a data backfill.
- Two song representations coexist briefly (free-typed `songDetails`-only items
  and library-linked items); the picker nudges toward the library, and nothing
  is force-migrated (ADR-024).

## Open questions

1. Should charts be viewable by **all** assigned volunteers, or gated further
   (some churches restrict sheet music)? Default to plan-assigned members;
   revisit if a church needs tighter control.
2. Should the song library be seedable/importable from an existing PCO plan
   (one-time map of a plan's songs → `songs`, carrying CCLI#s) to ease the
   switch? Likely a useful migration aid; deferred to a follow-up.
3. Per-item multitracks override vs. song-level only — start song-level; add the
   per-item override if a real "different mix this week" need appears.
