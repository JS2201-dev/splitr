# Splitr

Mobile-first PWA for splitting group expenses on trips, outings and events.
One person (the **Organizer/Collector**) tracks what everyone spent; the app
works out who owes what and tracks payments until the whole thing is settled.

**Phase 1 is complete, with the first Phase 2 browser features implemented.**
See [Phase 2 seam](#phase-2-seam) for supported flows and remaining integrations.

```bash
npm install      # Node 22.12+
npm run dev      # http://localhost:5173
npm test         # 186 tests
npm run build
```

The app seeds a **5-person Goa trip with 8 expenses** on first run, so there is
something real to poke at immediately.

> **Note on npm:** the corporate registry (`cm-npmregistry.csez.zohocorpin.com`)
> was returning 503, so `.npmrc` pins this project to the public registry. Delete
> that file once the internal mirror is healthy.

---

## Project structure

```
src/
├── domain/                   # Pure functions. No React, no storage, no I/O.
│   ├── types.ts              #   Entities. All money is integer minor units.
│   ├── money.ts              #   Parsing, formatting, and `allocate()` rounding
│   ├── split.ts              #   equal / exact / percent / shares → shares
│   ├── balances.ts           #   paid − share → net, per person
│   ├── settlement.ts         #   collector + minimal-transfer algorithms
│   ├── summary.ts            #   plain-English breakdowns, UPI deep links
│   ├── validation.ts         #   expense/payment rules, removal guards
│   └── __tests__/            #   118 unit tests
│
├── storage/                  # Persistence seam
│   ├── adapter.ts            #   StorageAdapter interface  ← swap point
│   ├── indexeddb.ts          #   Phase 1 implementation (idb)
│   ├── memory.ts             #   tests + fallback when IndexedDB is blocked
│   └── index.ts              #   resolution + graceful degradation
│
├── store/                    # Zustand: orchestration, audit trail, undo
│   ├── usePlanStore.ts
│   ├── useUiStore.ts         #   tab, theme, toasts
│   └── __tests__/            #   11 end-to-end tests over the real store
│
├── integrations/             # message parsing, reconciliation, GPay + flags
│   ├── types.ts              #   MessageParser, ParseResult, Reconciliation
│   ├── registry.ts           #   provider registration + best-result merge
│   └── flags.ts              #   supported browser features ON
│
├── export/
│   ├── csv.ts                #   expenses / balances / settlement / payments
│   ├── pdf.ts                #   jsPDF + autoTable (lazy-loaded)
│   └── share.ts              #   WhatsApp text, UPI links, QR codes
│
├── components/               # Sheets and shared UI
│   ├── ui.tsx                #   Sheet, Money, Avatar, Segmented, Toast…
│   ├── ExpenseSheet.tsx      #   add/edit with live split preview
│   ├── QuickAddSheet.tsx     #   "Dinner | 2400 | Rahul | Rahul, Anu"
│   ├── PaymentSheet.tsx      #   record payment + UPI link/QR
│   ├── PeopleSheet.tsx       #   attendees, roles, organizer reassignment
│   ├── CategoriesSheet.tsx   #   add / rename / hide
│   └── PlansSheet.tsx        #   multi-plan switcher + archive
│
├── screens/                  # The four tabs
│   ├── ExpensesTab.tsx  ├── BalancesTab.tsx
│   ├── SettleTab.tsx    └── SummaryTab.tsx
│
├── lib/quickAdd.ts           # Quick-add line parser (Phase 1)
└── data/                     # Default categories + the Goa demo seed
```

**The dependency rule:** `domain/` imports nothing from the rest of the app.
Everything else may import `domain/`. That is what keeps the money logic
testable in isolation and reusable from a future server.

---

## The settlement algorithm

### 1. Money is never a float

`0.1 + 0.2 !== 0.3` in IEEE-754. An app that drifts by a paise per expense will
not balance to zero after fifty of them. So amounts are parsed to **integer
minor units** (paise) at the edge, every calculation is integer arithmetic, and
decimals only reappear at render time.

### 2. Splitting: largest-remainder allocation

`allocate(total, weights, tieBreakKeys)` in [`money.ts`](src/domain/money.ts)
is the core primitive. ₹100 across 3 people is ₹33.333… each — impossible in
paise. The Hamilton (largest-remainder) method:

1. Floor every share: `33.33, 33.33, 33.33` → 1 paise undistributed.
2. Hand leftover units to the entries with the largest discarded fraction.
3. **Break ties on person id**, not array position.

```
allocate(10000, [1,1,1], ['anu','rahul','vikram'])  →  [3334, 3333, 3333]
```

Step 3 is the part that matters. Without it, re-ordering the participant chips
would silently move whose share carries the extra paise, and the numbers would
shuffle on every reload. With it, the same person always absorbs the remainder.

**Guaranteed for every split type: `sum(shares) === amountMinor` exactly.**
Negative totals (refunds) allocate by magnitude and re-sign, so `-₹100` splits
as `-33.34 / -33.33 / -33.33` and still sums exactly.

| Split type | Weights fed to `allocate` |
|------------|---------------------------|
| `equal`    | all `1`                   |
| `exact`    | not allocated — validated to sum to the total |
| `percent`  | the percentages themselves (not pre-converted to amounts) |
| `shares`   | the raw weights           |

Percentages are allocated on the raw percentage weights rather than converting
each to an amount first — that keeps the sum exact even for `33.33 / 33.33 / 33.34`.

### 3. Balances

```
netFromExpenses = Σ(paid)  −  Σ(share)
net             = netFromExpenses  +  Σ(payments made)  −  Σ(payments received)
```

Positive = gets money back. Negative = owes. **`Σ(all nets) === 0` always** —
every expense's shares sum to its amount, and every payment just moves money
between two people. The Balances tab surfaces a loud error if this ever drifts,
because showing wrong numbers silently is worse than admitting a bug.

People are seeded from the roster, not from expense rows, so someone added
late or with no expenses shows a zero balance instead of vanishing.

### 4. Two settlement modes

**Collector mode** (default) — everyone squares up with the Organizer and
nobody else. The Organizer is a clearing house: collects from debtors, pays out
to anyone who fronted money. More transfers, but *one number per person*, which
is how group trips actually work. The Organizer's own net is the balancing
item, never a transfer.

**Minimal-transfers mode** — greedy: repeatedly match the largest debtor to the
largest creditor and move `min(|debt|, credit)`.

```
nets: A +600, B −400, C −200
  →  B pays A ₹400
  →  C pays A ₹200
```

This produces at most `n−1` transfers. It is a heuristic, not provably optimal —
minimising transaction count exactly is NP-hard (equivalent to multi-way number
partitioning) — but it matches the true optimum on realistic group sizes, and an
exponential search is not worth it for a trip with eight people. Ties break on
person id so the output is stable.

Minimal mode can never move *more* money than collector mode, because it cancels
debts that would otherwise round-trip through the Organizer. On the demo data:
₹48,164 vs ₹51,701.

### 5. Tracking payments against obligations

The obligation list is derived from balances **before** payments, then each
directed pair is credited with what has been recorded against it:

```
remaining = max(0, due − paid)
credit    = max(0, paid − due)
status    = remaining === 0 ? 'paid' : paid > 0 ? 'partial' : 'pending'
```

Deriving from *pre-payment* balances is deliberate. Recomputing the optimal
transfer set after every partial payment would silently re-plan who-pays-whom
out from under people who are halfway through paying it off. It also makes the
acceptance check hold by construction:

```
Σ(recorded payments)  +  Σ(remaining)  ===  Σ(original dues)
```

Payments to someone outside the planned set (paid the wrong person, or overpaid
in a new direction) still appear as a credit row, so money never disappears
from the Settle-up tab.

---

## Edge cases handled

| Case | Behaviour |
|------|-----------|
| Person added after expenses exist | Starts at zero; existing expenses untouched |
| Person removed with a balance | **Blocked**, with the reason |
| Person square but on expense rows | Blocked — their name would become unattributable |
| Organizer removal | Blocked; reassign the role first |
| Payer not in the split | Fine — they paid for others, net is the full amount |
| Organizer pays for only themselves | Net zero, no obligation created |
| Zero-balance people | Shown as "All square", excluded from transfers |
| Refunds / negative expenses | Allocated by magnitude and re-signed; sums exactly |
| Duplicate expense | **Warning** (same amount + payer + date), dismissible — two ₹200 cabs in one day is normal |
| Rounding with 3+ people | Largest-remainder with id tie-break |
| Multiple payers | Supported; validated to sum to the total |
| IndexedDB unavailable | Falls back to memory with a visible warning banner |

---

## Phase 2 seam

The browser implementation includes:

- **GPay:** payment buttons use Android `intent://` with the package
  `com.google.android.apps.nbu.paisa.user` and a Play Store fallback. iOS uses
  `gpay://upi/pay`. QR codes and PDF payment links retain generic `upi://pay`
  for any compatible UPI app. UPI is offered only for INR plans. WhatsApp
  sharing is unchanged. Actual intent handling needs testing on a real Android
  phone with GPay installed; a desktop browser cannot validate app launch.
- **Excel:** Summary → Export Excel downloads a real `.xlsx` file with Balances,
  Expenses, Settlement and Payments sheets. Money cells are numbers; user text
  is stored as strings. Headers are frozen and filters are enabled.
- **Message capture:** Menu → Capture SMS / email reads pasted text locally.
  It extracts INR amounts, merchants, supported numeric/month-name dates and
  payment direction. Merchant hints map Swiggy to Food and Uber to Travel.
  `#food` selects a category; `@rahul @anu` selects split participants. The
  current plan is always the destination; `#goa` does not switch plans.
  Available balances are excluded, conflicting amounts stay blank, and
  ambiguous names need manual review. Formats outside these heuristics need
  correction. Review expense details opens the full editable expense form;
  confirm the payer (initially the organizer), participants and date before saving.
- **Reconciliation:** incoming credits suggest a pending balance only when the
  sender matches one person by full name or UPI ID and the amount fits the
  remaining balance. Partial payments are supported. The sender, recipient,
  amount, date, method and reference remain editable. An already-recorded
  reference blocks a duplicate. Messages without references still require
  manual duplicate checking. Every payment requires explicit confirmation;
  neither confidence nor returning from GPay marks anyone paid.
- **Reminders:** each pending balance offers Copy reminder. This creates a
  draft with the current remaining amount and, when available, a payment link.
  The user pastes/sends it; nothing is sent automatically.
- **QR sharing:** Summary → Share summary opens per-person QR cards with share
  and download actions. Export PDF appends the same QR codes. Browser Print /
  Save as PDF prints the current view and does not append QR pages.

`messageParsing`, `tagConventions`, `paymentReconciliation` and `reminders`
default to enabled. Other integration flags remain off. The parser registry
includes the local provider. `CONFIDENCE_THRESHOLD` controls review guidance,
never automatic saving. Runtime flags can be changed for development:

```js
localStorage.setItem('splitr.flags', '{"messageParsing":true}')
// Reload after changing an override.
```

Implementation references:
[Google Pay package targeting](https://developers.google.com/pay/india/api/android/in-app-payments),
[Chrome intent syntax and fallback](https://developer.chrome.com/docs/android/intents).

---

## Testing

```
186 tests across 12 files

domain/money         18   parsing, formatting, allocate() across group sizes
domain/split         22   equal / exact / percent / shares, refunds, guards
domain/balances      12   nets, multi-payer, refunds, late additions
domain/settlement    30   both modes, partial/over payments, acceptance invariant
domain/validation    18   expense rules, duplicates, removal guards
lib/quickAdd         20   the "Dinner | 2400 | Rahul" parser
export/csv           12   escaping, formula injection, UPI link format
export/backup        15   import validation and round-trip integrity
export/excel          3   OOXML structure, numeric cells, reminder drafts
integrations         10   message extraction, GPay URLs, reconciliation
data/seed             7   demo data invariants
store/usePlanStore   19   end-to-end: persistence, audit, undo, settling
```

Both acceptance criteria are asserted as invariants, re-checked after *every*
mutation in the store tests:

1. `Σ(all net balances) === 0`
2. `Σ(payments) + Σ(remaining dues) === Σ(original dues)` — in **both** modes

---

## Decisions worth knowing

- **Local-only storage.** IndexedDB behind `StorageAdapter`. No accounts, works
  offline. A Supabase adapter drops into `getStorage()` without touching call sites.
- **PDF via both paths.** jsPDF for a real downloadable file (lazy-loaded, ~420KB
  chunk fetched only on export), plus a print stylesheet for browser "Save as PDF".
- **The PDF says `INR 1,234.50`, not `₹1,234.50`.** jsPDF's built-in fonts are
  Latin-1 and have no U+20B9 glyph. Embedding a Unicode TTF costs ~300KB for one
  character — a bad trade in a mobile PWA. The on-screen UI uses ₹ throughout.
- **Excel text stays text.** The `.xlsx` writer uses inline strings for user
  content; formula-like expense names never become executable formulas.
  CSV helpers are retained internally for compatibility, but the UI exports Excel.
- **UPI deep links are one-way.** `upi://pay?pa=…&am=…&cu=INR&tn=…` opens the
  payer's app with everything pre-filled, but cannot confirm the payment
  happened. The UI says so, and settlement still needs a recorded payment.
- **Categories hide, never delete.** Deleting one would orphan its expenses.

---

## Remaining Phase 2 work

- **Native wrapper and payment results:** no Capacitor/Android project exists
  in this repository yet. Add an Android activity/plugin that launches a
  package-targeted payment intent and returns the result for its original
  obligation, amount and transaction ID. A browser return/focus event is not
  proof of payment. Native success responses also need validation and duplicate
  protection; do not treat arbitrary JavaScript events or query parameters as
  verified payment results. TWA alone does not supply this bridge.
- **Consent-gated SMS/notifications:** implement in that native wrapper with
  explicit opt-in, revocation and platform permissions. Forward candidates
  through the same mandatory review flow. No background listeners run today.
- **LLM parser:** add a server proxy and provider credentials, plus authenticated
  access/rate limits and user consent before transmitting pasted financial
  messages. Never put the provider key in a `VITE_*` variable or browser bundle.
  The existing `MessageParser` contract is the integration point. No remote
  messages are sent and no LLM provider is configured today.
- **Nice-to-haves:** receipt OCR, live FX rates with stored rate/date provenance,
  and a validated Splitwise CSV import preview remain unimplemented. Automatic
  email ingestion is also pending; pasted email text works now.

Local verification: typecheck, 186 unit tests, production/PWA build, and browser
review of capture and sharing flows. The generated workbook was independently
opened with openpyxl and checked for numeric amounts, totals, filters and frozen
headers. Deployments use the existing Netlify project and configuration. The production
site is https://symphonious-wisp-49d823.netlify.app/.

## Deployment readiness verification (21 October 2026)

- Typecheck, all 186 tests and production/PWA build pass.
- Production UI checked at 390 × 844: expenses, summary and settlement fit
  without horizontal overflow.
- A backup downloaded from the production UI was imported as a separate plan.
  Expenses, payments, totals and the restore audit entry survived a reload.
- With the preview server stopped, the app reloaded from its service-worker
  cache and retained the restored plan. Settlement navigation remained usable.
- The iOS GPay URL was corrected to the official `gpay://upi/pay?...` format;
  Android retains its package-targeted `intent://` link.
- `public/_headers` and `public/_redirects` make manual Netlify uploads retain
  PWA update caching rules and SPA routing. Node 22 is pinned in `.nvmrc`;
  the package requires Node 22.12 or newer.
- Actual GPay app launch still needs verification on a real Android device.
- Production deployment uses the connected `JS2201-dev/splitr` GitHub repository.
  Netlify automatically builds and publishes updates to `main`.
