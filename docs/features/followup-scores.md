# Follow-Up Page Scores

The follow-up page (the member **Health** / People table in Leader Tools) shows
three engagement scores for every person, each from **0–100%**:

| Column        | Score slot | What it measures                                              |
| ------------- | ---------- | ------------------------------------------------------------ |
| **Serving**   | `score1`   | How often the person serves (Planning Center serving teams). |
| **Attendance**| `score2`   | How consistently the person attends meetings.                |
| **Connection**| `score3`   | How well leaders are connecting with the person — the primary triage score. |

> The **Serving** column was previously labeled "Service". The underlying data and
> the `service:` search filter are unchanged; only the display label was renamed.

Scores are color-coded so leaders can triage at a glance:

- 🟢 **Green — 70+**: healthy.
- 🟠 **Orange — 40–69**: needs attention.
- 🔴 **Red — &lt;40**: at risk; prioritize outreach.

Scores are recomputed automatically on a daily refresh (see
`apps/convex/functions/communityScoreComputation.ts`). The exact formulas live in
`apps/convex/functions/systemScoring.ts` (`calculateSystemScore`), and a per-person
breakdown is available in-app via the **Score Breakdown** modal
(`ScoreBreakdownModal`).

---

## Serving (Score 1)

**Meaning.** Measures serving engagement over the past 2 months, based on Planning
Center Online (PCO) serving activity.

**How it's calculated.** Each service in the past 2 months adds **20 points**,
capped at **100** (reached at **5+ services**):

```
serving = min(100, services_in_past_2_months × 20)
```

**How to improve it.**

- Get the person plugged into a serving team so their PCO serving activity is
  tracked.
- Aim for at least **5 services over 2 months** (roughly serving every other week)
  to reach a full score.
- Confirm the person is correctly matched to their PCO profile — serving that
  isn't recorded in PCO won't count.

---

## Attendance (Score 2)

**Meaning.** The percentage of meeting weeks the person attended across all of
their groups in the community.

**How it's calculated.** Over a join-date-adjusted ~60-day window, it's the share
of weeks (that had a meeting) in which the person attended at least once:

```
attendance = round( attended_weeks / total_weeks_in_window × 100 )
```

A person who attended every meeting week scores 100; someone who attended none
scores 0. If there were no meeting weeks in the window, the score is 0.

**How to improve it.**

- Encourage consistent weekly attendance — the score reflects recent consistency,
  not a single visit.
- Make sure attendance is actually recorded for each meeting (via check-in or the
  attendance editor); unrecorded attendance lowers the score.

---

## Connection (Score 3)

**Meaning.** How well leaders are connecting with this person. This is the primary
score for deciding **who needs outreach**. It combines attendance consistency with
the recency and quality of follow-ups, so that the *less* someone attends, the
*more* recent follow-up matters.

**How it's calculated.** Two parts that add up to a max of 100:

1. **Attendance portion (up to 70 points).** Driven by consecutive missed
   meetings. Attending the most recent meeting gives full credit; each consecutive
   miss deducts 15 percentage points (7+ misses → 0). If the person has never
   attended in the window, this portion is 0 and the score depends entirely on
   follow-up.

2. **Follow-up portion (fills the rest, up to 100).** The most recent follow-up
   fills the remaining points, by channel:
   - **In-person visit** → fills 100% of the remaining space (fades over ~100 days)
   - **Phone call** → fills 75% (fades over ~85 days)
   - **Text message** → fills 50% (fades over ~70 days)

   Follow-ups fade over time, so a fresh contact counts for more than an old one.
   If the person has **zero attendance**, follow-ups fade **twice as fast** to
   reflect the added urgency.

```
attendance_portion = attended ? round(70 × max(0, 100 − consecutive_missed × 15) / 100) : 0
follow_up_portion  = round((100 − attendance_portion) × best_recent_follow_up_fill)
connection         = min(100, attendance_portion + follow_up_portion)
```

**How to improve it.**

- **Log every follow-up** (in-person, call, or text) on the person's record —
  follow-ups are the main lever for this score, especially for low attenders.
- Prefer higher-touch contact when you can: an **in-person** visit moves the score
  more than a call, and a call more than a text.
- **Reach out before the last contact goes stale** — because follow-ups decay, a
  recent text can outscore an old in-person visit.
- Help the person attend more consistently; rebuilding attendance raises the
  attendance portion and reduces how much follow-up is needed to stay healthy.

---

## Related

- Scoring engine: `apps/convex/functions/systemScoring.ts`
- Daily refresh: `apps/convex/functions/communityScoreComputation.ts`
- Score column definitions (display labels): `apps/mobile/features/leader-tools/components/followupShared.ts`
- In-app breakdown UI: `apps/mobile/features/leader-tools/components/ScoreBreakdownModal.tsx`
- Read-only "Scores" explainer in the People settings panel: `apps/mobile/features/leader-tools/components/FollowupSettingsPanel.tsx`
