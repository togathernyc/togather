# Attendance API

A read-only HTTP API that lets an external app (e.g. an attendance dashboard)
pull a community's group attendance data from Togather. Togather is the source
of truth — external systems should sync from this endpoint rather than
maintaining their own copy of which events exist.

The API returns **aggregate counts only** (attended, guests, RSVP tallies). It
never exposes member names or any personal information.

## Authentication

Requests authenticate with a community-scoped **API key**. A key only ever sees
data for the community that issued it.

Create and revoke keys in the mobile app: **Admin → Settings → Developer → API
Keys**. The raw key is shown exactly once, at creation time — copy it then. Only
a hash is stored, so a lost key must be revoked and replaced.

Pass the key on every request as a bearer token:

```
Authorization: Bearer tgk_xxxxxxxxxxxxxxxx
```

`x-api-key: tgk_...` is also accepted.

## Endpoint

```
GET https://<your-deployment>.convex.site/api/v1/attendance
```

The exact base URL for a community is shown on the API Keys screen in the app.

### Query parameters (all optional)

| Param       | Type             | Description                                                        |
| ----------- | ---------------- | ------------------------------------------------------------------ |
| `since`     | Unix ms or ISO   | Only events scheduled at/after this time.                          |
| `until`     | Unix ms or ISO   | Only events scheduled at/before this time.                         |
| `groupType` | string (slug)    | Limit to one group type, e.g. `dinner-parties`.                    |
| `status`    | string           | `scheduled`, `completed`, or `cancelled`.                          |
| `limit`     | integer          | Max events to return. Default `200`, max `1000`.                   |

Events are returned newest-first. `since`/`until` filter on each event's
**scheduled date** — not on when attendance was recorded — so they form a date
window, not a change cursor. There is no "updated since" cursor: to keep a
dashboard current (including attendance edited after an event), re-pull a
trailing window each poll (e.g. the last 90 days) and upsert, rather than
advancing a cursor to "now."

`hasMore: true` means more matching events exist than were returned — either the
page `limit` was reached, or an internal scan cap was hit before the timeline
was exhausted (possible with selective `status`/`groupType` filters). Narrow the
`since`/`until` window to page through the rest.

### Example

```bash
curl -H "Authorization: Bearer $TOGATHER_API_KEY" \
  "https://<deployment>.convex.site/api/v1/attendance?groupType=dinner-parties&since=2026-01-01"
```

### Response

```json
{
  "community": { "id": "...", "name": "Fount", "subdomain": "fount" },
  "generatedAt": "2026-06-16T14:22:13.000Z",
  "limit": 200,
  "hasMore": false,
  "events": [
    {
      "id": "...",
      "title": "Tuesday Dinner Party",
      "scheduledAt": "2026-06-10T23:00:00.000Z",
      "status": "completed",
      "group": {
        "id": "...",
        "name": "Tuesday Dinner",
        "groupType": "Dinner Parties",
        "groupTypeSlug": "dinner-parties"
      },
      "attendance": {
        "attended": 12,
        "guests": 3,
        "rsvps": { "going": 14, "notGoing": 1, "maybe": 2, "guestsExpected": 5 }
      }
    }
  ]
}
```

Field notes:

- `attended` — number of members marked present for the event.
- `guests` — number of guest (non-member) records logged for the event.
- `rsvps.guestsExpected` — sum of plus-ones declared by "going" RSVPs.

## Errors

| Status | Meaning                                              |
| ------ | ---------------------------------------------------- |
| `401`  | Missing, invalid, or revoked API key.                |
| `400`  | Invalid `since`/`until`/`status`/`limit` parameter.  |
| `500`  | Unexpected server error.                             |

## Implementation

- Route + auth: `apps/convex/http.ts` (`GET /api/v1/attendance`)
- Key verification + aggregation: `apps/convex/functions/publicApi.ts`
- Key management (admin): `apps/convex/functions/admin/apiKeys.ts`
- Key generation/hashing: `apps/convex/lib/apiKeys.ts`
- Schema: `apiKeys` table in `apps/convex/schema.ts`
