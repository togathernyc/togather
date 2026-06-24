# Wireframes: Nonprofit Financial Features

ASCII wireframes to visualize the giving / funds / budgets / cards experience.
These are **low-fidelity layout sketches**, not final design — they show
information architecture, primary actions, and states. Mobile screens use a phone
frame; admin reporting uses a wide frame (web/tablet).

- **Companion docs:** PRD `docs/plans/nonprofit-financial-features-prd.md`;
  ADRs 028 (foundation), 029 (statements), 030 (budgets/reporting), 031 (cards),
  032 (community-wide).
- **Legend:** `[ Button ]`  `(•) selected`  `( ) option`  `[x] checkbox`
  `▓▓▓░░ progress`  `›` navigates  `⌃` tab bar.

---

## 0. Map of screens → ADR

| # | Screen | Audience | ADR |
|---|--------|----------|-----|
| 1 | Enable Giving (onboarding gate) | Admin | 028 |
| 2 | Create / edit a group fund | Leader/Admin | 028 |
| 3 | Group detail with Give CTA + goal | Member | 028 |
| 4 | Give flow (amount → pay → done) | Donor | 028 |
| 5 | My Giving (history + statements) | Donor | 028/029 |
| 6 | Giving statement (PDF layout) | Donor | 029 |
| 7 | Set group budget | Leader/Admin | 030 |
| 8 | Group leader money dashboard | Leader | 030/031 |
| 9 | Treasurer financial dashboard | Admin | 030 |
| 10 | Issue a card | Leader/Admin | 031 |
| 11 | Card detail + transactions | Cardholder | 031 |
| 12 | Receipt capture | Cardholder | 031 |

---

## 1. Enable Giving — onboarding gate (Admin)  · ADR-028

The gate that flips `givingStatus` to `active`. Each step is a real precondition.

```
┌───────────────────────────────────┐
│ ‹ Settings        Enable Giving    │
├───────────────────────────────────┤
│                                    │
│  Set up giving for Grace Community │
│  Donors can give once you finish   │
│  these steps.                      │
│                                    │
│  ✓  Nonprofit verified             │
│     EIN 12-3456789                 │
│                                    │
│  ◷  Bank & identity (Stripe)       │
│     In review — usually 1–2 days   │
│     [ Continue setup › ]           │
│                                    │
│  ○  Apple nonprofit approval       │
│     Required for in-app giving     │
│     [ Start › ]                    │
│                                    │
│  ─────────────────────────────     │
│  Status:  ◷ Onboarding             │
│  Giving unlocks when all 3 done.   │
│                                    │
└───────────────────────────────────┘
```

States the banner can show: `Pending` · `Onboarding` · `● Active` · `Suspended`.
Until **Active**, every Give button is hidden/disabled with the reason shown.

---

## 2. Create / edit a group fund  · ADR-028

A leader opens a fund for their group's purpose.

```
┌───────────────────────────────────┐
│ ‹ Youth Group        New Fund      │
├───────────────────────────────────┤
│  Fund name                         │
│  ┌─────────────────────────────┐   │
│  │ Summer Missions Trip        │   │
│  └─────────────────────────────┘   │
│                                    │
│  Purpose (shown to donors)         │
│  ┌─────────────────────────────┐   │
│  │ Sending 12 students to...   │   │
│  └─────────────────────────────┘   │
│                                    │
│  Fundraising goal (optional)       │
│  ┌─────────────────────────────┐   │
│  │ $ 4,000                     │   │
│  └─────────────────────────────┘   │
│                                    │
│  [x] Restricted (spend only on     │
│      this purpose)                 │
│  [x] Visible to donors             │
│                                    │
│  ⓘ Gifts go to Grace Community     │
│    (501c3) designated to this fund.│
│                                    │
│         [ Create fund ]            │
└───────────────────────────────────┘
```

The `ⓘ` note is the key legal framing from ADR-028 §4.1 — group fund =
designation inside the community's 501c3.

---

## 3. Group detail with Give CTA + goal  · ADR-028

Where a member encounters the ask, in the context of the group.

```
┌───────────────────────────────────┐
│ ‹ Explore        Youth Group       │
├───────────────────────────────────┤
│  ████ cover image ████             │
│  Youth Group · Mondays 6pm         │
│  ─────────────────────────────     │
│  💛 Summer Missions Trip           │
│     ▓▓▓▓▓▓▓▓▓░░░░░░  $2,640/$4,000 │
│     66% · 38 donors                │
│                                    │
│        [  Give to this fund  ]     │
│                                    │
│  ─────────────────────────────     │
│  About                             │
│  Sending 12 students to serve...   │
│                                    │
│  Members (24)        Chat   Events │
│  ( ◯ ◯ ◯ ◯ +20 )                  │
│                                    │
├───────────────────────────────────┤
│  ⌃ Home  Explore  Give  Chat  Me   │
└───────────────────────────────────┘
```

---

## 4. Give flow  · ADR-028

### 4a. Amount + fund

```
┌───────────────────────────────────┐
│ ✕                 Give             │
├───────────────────────────────────┤
│  To:  Summer Missions Trip   ›     │
│       (Youth Group)                │
│                                    │
│            $  50                    │
│      ┌────┬────┬────┬────┐         │
│      │ 25 │ 50 │100 │ ⌨  │         │
│      └────┴────┴────┴────┘         │
│                                    │
│  Frequency                         │
│   (•) One time                     │
│   ( ) Monthly   ( ) Weekly         │
│                                    │
│  [x] Cover the 2.2% fee (+$1.10)   │
│      so the group gets 100%        │
│  [ ] Give anonymously to leaders   │
│                                    │
│   ────────────────────────────     │
│   Total today           $51.10     │
│         [   Pay   ]                │
└───────────────────────────────────┘
```

### 4b. Apple Pay sheet (native) → 4c. Confirmation

```
┌───────────────────────────────────┐      ┌───────────────────────────────────┐
│         ⓘ Apple Pay                │      │                                    │
│  ┌─────────────────────────────┐   │      │            ✓                       │
│  │  Grace Community            │   │      │      Thank you!                    │
│  │  Summer Missions Trip       │   │      │                                    │
│  │  Pay  $51.10                │   │      │  $51.10 to Summer Missions Trip    │
│  └─────────────────────────────┘   │      │  Receipt sent · tax-deductible     │
│   Card  ••••  4242            ›    │      │                                    │
│                                    │      │  ▓▓▓▓▓▓▓▓▓▓░░  $2,691/$4,000       │
│      Side button to confirm        │      │  You moved the goal 1%!            │
│         ◉ ◉ ◉                      │      │                                    │
│                                    │      │   [ View my giving ]  [ Done ]     │
└───────────────────────────────────┘      └───────────────────────────────────┘
```

---

## 5. My Giving — history + statements  · ADR-028 / 029

```
┌───────────────────────────────────┐
│ ‹ Me              My Giving        │
├───────────────────────────────────┤
│  2025 to date                      │
│  ┌─────────────────────────────┐   │
│  │  $1,310.00   ·  9 gifts      │   │
│  │  [ ⬇ Download 2024 statement]│   │
│  └─────────────────────────────┘   │
│                                    │
│  Recurring                         │
│   💛 Youth Group · $50/mo   Manage›│
│                                    │
│  History                           │
│   Jun 21  Missions Trip    $51.10  │
│   Jun 01  Youth Group      $50.00  │
│   May 18  General Fund     $100.00 │
│   May 01  Youth Group      $50.00  │
│   Apr 14  Benevolence      $25.00  │
│            · · ·                   │
│                                    │
│  Statements                        │
│   2024  ⬇    2023  ⬇              │
└───────────────────────────────────┘
```

"Manage" on a recurring gift → pause / change amount / change fund / cancel
(ADR-028 §5).

---

## 6. Giving statement — PDF layout  · ADR-029

The generated document (stored in R2, downloaded in-app). Must satisfy IRS Pub.
1771.

```
╔═══════════════════════════════════════════════╗
║  GRACE COMMUNITY CHURCH        [logo]          ║
║  123 Main St, Austin TX 78701                  ║
║  EIN 12-3456789                                ║
║                                                ║
║  2024 Annual Giving Statement                  ║
║  ─────────────────────────────────────────     ║
║  Donor:  Jordan Rivera                         ║
║          456 Oak Ave, Austin TX 78704          ║
║  Period: Jan 1 – Dec 31, 2024                  ║
║                                                ║
║  Date     Fund / Designation        Amount     ║
║  01/07/24 Youth Group               $ 50.00    ║
║  02/04/24 Youth Group               $ 50.00    ║
║  03/03/24 General Fund              $100.00    ║
║  ...                                           ║
║  ─────────────────────────────────────────     ║
║  Total contributions          $ 1,180.00       ║
║  Total deductible             $ 1,180.00       ║
║                                                ║
║  No goods or services were provided in         ║
║  exchange for these contributions.             ║
║                                                ║
║  Keep this receipt for your tax records.       ║
║  Issued 01/15/2025 · v1                        ║
╚═══════════════════════════════════════════════╝
```

The "No goods or services…" line is computed from gift tags; quid-pro-quo or
intangible-religious-benefit wording substitutes when applicable (ADR-029 §2).

---

## 7. Set group budget  · ADR-030

```
┌───────────────────────────────────┐
│ ‹ Youth Group     Budget           │
├───────────────────────────────────┤
│  Fund:  Youth Group operating  ›   │
│                                    │
│  Budget amount                     │
│  ┌─────────────────────────────┐   │
│  │ $ 2,000                     │   │
│  └─────────────────────────────┘   │
│  Period                            │
│   (•) Per year   ( ) Per month     │
│                                    │
│  Unspent at period end             │
│   (•) Rolls over                   │
│   ( ) Expires                      │
│                                    │
│  ⓘ Budget is a spending cap. Money │
│    to spend comes from this fund's │
│    balance and issued cards.       │
│                                    │
│          [ Save budget ]           │
└───────────────────────────────────┘
```

The `ⓘ` reflects ADR-030's budget-vs-balance distinction (cap ≠ money).

---

## 8. Group leader money dashboard  · ADR-030 / 031

```
┌───────────────────────────────────┐
│ ‹ Youth Group     Money            │
├───────────────────────────────────┤
│  Budget (2025)                     │
│   ▓▓▓▓▓▓▓░░░░░░░  $740 / $2,000    │
│   $1,260 remaining · 37% used      │
│                                    │
│  Fund balance         $3,431.00    │
│   (raised $4,171 − spent $740)     │
│                                    │
│  Cards                             │
│   💳 Jordan R. ••4242  $120/$500mo │
│   💳 Sam P.    ••7781  frozen      │
│            [ + Issue card ]        │
│                                    │
│  Recent spend                      │
│   Jun 20  HEB Groceries   $42.18 ⚠ │
│   Jun 18  Amazon          $63.40 ✓ │
│   ⚠ = receipt needed               │
│                                    │
│  Recent gifts                      │
│   Jun 21  J. Rivera       $51.10   │
└───────────────────────────────────┘
```

---

## 9. Treasurer financial dashboard  · ADR-030  (wide / web)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Grace Community · Finances            2025 ▾     [ Export CSV ]  [ ⚙ ]    │
├──────────────────────────────────────────────────────────────────────────┤
│  Given YTD        Designated        General        Spent YTD              │
│  $48,210          $31,940           $16,270         $9,815                │
│                                                                          │
│  Giving over time                                                         │
│   $k                                                  ▁▂▃▅▇▆▅▇█           │
│    8 ┤                                    ▂▃▅▆▇▆▅▇█                       │
│    4 ┤              ▂▃▄▅▆▅▄▅▆▇                                           │
│    0 ┼────────────────────────────────────────────────────────          │
│       J  F  M  A  M  J  J  A  S  O  N  D                                  │
│                                                                          │
│  Funds & budgets                  Balance     Budget     Used    Receipts │
│   Youth Group                     $3,431     $2,000      37%      1 ⚠     │
│   Missions Trip      (restricted) $2,691         —        —       0       │
│   Benevolence        (restricted) $1,120     $3,000      8%       0       │
│   General Fund                   $16,270     $20,000     41%      2 ⚠     │
│                                                                          │
│  Statements (2024):  412 issued · 6 pending · 0 failed     [ View › ]     │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Issue a card  · ADR-031

```
┌───────────────────────────────────┐
│ ✕              Issue Card          │
├───────────────────────────────────┤
│  Spends from                       │
│   Youth Group operating  ($3,431)› │
│                                    │
│  Card model                        │
│   (•) Per person  (recommended)    │
│   ( ) Shared group card            │
│                                    │
│  Cardholder                        │
│   ┌─────────────────────────────┐  │
│   │ ◯ Jordan Rivera (leader)  ▾ │  │
│   └─────────────────────────────┘  │
│                                    │
│  Type   (•) Virtual  ( ) Physical  │
│                                    │
│  Spending limit                    │
│   $ 500   per  ( monthly ▾ )       │
│                                    │
│  ⚠ Issuing balance not yet funded. │
│    [ Fund from bank → ~1–5 days ]  │
│                                    │
│        [ Issue virtual card ]      │
└───────────────────────────────────┘
```

The funding warning is the ADR-031 §2 reality (Issuing balance must be funded
before a card transacts). Per-person is pre-selected per the PRD recommendation.

---

## 11. Card detail + transactions  · ADR-031

```
┌───────────────────────────────────┐
│ ‹ Money          Jordan's Card     │
├───────────────────────────────────┤
│   ┌─────────────────────────────┐  │
│   │  GRACE COMMUNITY            │  │
│   │  Youth Group                │  │
│   │  ••••  ••••  ••••  4242     │  │
│   │  VIRTUAL            ● active │  │
│   └─────────────────────────────┘  │
│   [  Add to Apple Wallet  ]        │
│                                    │
│   Spent this month   $120 / $500   │
│   ▓▓▓░░░░░░░░░░░░                  │
│                                    │
│   [ ❄ Freeze ]   [ ⚙ Limits ]      │
│                                    │
│  Transactions                      │
│   Jun 20  HEB Groceries   $42.18 ⚠ │
│   Jun 18  Amazon          $63.40 ✓ │
│   Jun 12  Chick-fil-A     $14.42 ✓ │
│                                    │
│   ⚠ tap to add receipt             │
└───────────────────────────────────┘
```

---

## 12. Receipt capture  · ADR-031

Prompted right after a transaction posts (and from the ⚠ items above).

```
┌───────────────────────────────────┐
│ ✕            Add Receipt           │
├───────────────────────────────────┤
│   HEB Groceries · $42.18           │
│   Jun 20, 2025 · Youth Group       │
│                                    │
│   ┌─────────────────────────────┐  │
│   │                             │  │
│   │        📷                   │  │
│   │   Tap to photograph         │  │
│   │   or [ choose from library ]│  │
│   │                             │  │
│   └─────────────────────────────┘  │
│                                    │
│   Note (optional)                  │
│   ┌─────────────────────────────┐  │
│   │ Snacks for Mon. meeting     │  │
│   └─────────────────────────────┘  │
│                                    │
│          [ Save receipt ]          │
└───────────────────────────────────┘
```

For **shared** cards (Phase 5), this screen also asks **"Who spent this?"** since
the transaction can't attribute automatically (ADR-031 §7).

---

## Notes & open visual questions

- **Give entry points:** a global `Give` tab (shown in #3) appears only when at
  least one visible fund exists and `givingStatus = active`. For group-first
  communities with community-wide giving **off** (ADR-032), the tab still works —
  it lists group funds, just not a "General fund."
- **Card art** is Stripe-default for v1; community-branded card art is a later
  polish item.
- **Treasurer dashboard** is drawn wide (web/tablet); a condensed mobile version
  stacks the four KPIs and makes the fund table horizontally scrollable.
- These are layout sketches — spacing, exact copy, and component choices follow
  the app's existing design system at build time (CLAUDE.md: prefer framework /
  existing components).
