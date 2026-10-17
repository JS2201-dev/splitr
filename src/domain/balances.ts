import type { Expense, Payment, Person } from './types'

export interface PersonBalance {
  personId: string
  /** Total this person put in across all expenses. */
  paidMinor: number
  /** Total this person consumed across all expenses. */
  shareMinor: number
  /** `paid - share`. Positive = owed money back, negative = owes money. */
  netFromExpensesMinor: number
  /** Payments this person has sent to others. */
  paidOutMinor: number
  /** Payments this person has received from others. */
  receivedMinor: number
  /**
   * What's actually outstanding right now:
   * `netFromExpenses + paidOut - received`.
   * Positive = still to receive, negative = still to pay, zero = square.
   */
  netMinor: number
}

export type BalanceSheet = Map<string, PersonBalance>

function blank(personId: string): PersonBalance {
  return {
    personId,
    paidMinor: 0,
    shareMinor: 0,
    netFromExpensesMinor: 0,
    paidOutMinor: 0,
    receivedMinor: 0,
    netMinor: 0,
  }
}

/**
 * Build the full balance sheet for a plan.
 *
 * People are seeded from the roster (not just from expense rows) so that
 * someone added late, or someone with no expenses at all, shows up with a
 * zero balance instead of silently vanishing from the Balances tab.
 */
export function computeBalances(
  people: Person[],
  expenses: Expense[],
  payments: Payment[] = [],
): BalanceSheet {
  const sheet: BalanceSheet = new Map()
  for (const person of people) sheet.set(person.id, blank(person.id))

  // An expense may still reference someone who was later deleted from the
  // roster. Keep their row rather than dropping money out of the system —
  // the sum-to-zero invariant matters more than a tidy roster.
  const ensure = (personId: string): PersonBalance => {
    let row = sheet.get(personId)
    if (!row) {
      row = blank(personId)
      sheet.set(personId, row)
    }
    return row
  }

  for (const expense of expenses) {
    for (const payer of expense.payers) {
      ensure(payer.personId).paidMinor += payer.amountMinor
    }
    for (const share of expense.shares) {
      ensure(share.personId).shareMinor += share.shareMinor
    }
  }

  for (const payment of payments) {
    ensure(payment.fromPersonId).paidOutMinor += payment.amountMinor
    ensure(payment.toPersonId).receivedMinor += payment.amountMinor
  }

  for (const row of sheet.values()) {
    row.netFromExpensesMinor = row.paidMinor - row.shareMinor
    row.netMinor = row.netFromExpensesMinor + row.paidOutMinor - row.receivedMinor
  }

  return sheet
}

/** Net position per person, keyed by id. The input to both settlement modes. */
export function netsFrom(sheet: BalanceSheet, key: 'netMinor' | 'netFromExpensesMinor' = 'netMinor') {
  const nets = new Map<string, number>()
  for (const [personId, row] of sheet) nets.set(personId, row[key])
  return nets
}

/**
 * The acceptance invariant: every expense's shares sum to its amount and every
 * payment moves money between two people, so the net of all nets must be
 * exactly zero. If this ever returns false there is a bug in the split or
 * payment path, and the UI should say so loudly rather than show wrong numbers.
 */
export function totalNet(sheet: BalanceSheet): number {
  let total = 0
  for (const row of sheet.values()) total += row.netMinor
  return total
}

export function isSettled(sheet: BalanceSheet): boolean {
  for (const row of sheet.values()) if (row.netMinor !== 0) return false
  return true
}

export interface ExpenseLineForPerson {
  expenseId: string
  name: string
  categoryId: string
  date: string
  shareMinor: number
  paidMinor: number
}

/**
 * The per-person itemisation behind a balance, for the plain-English
 * breakdown ("You owe ₹1,240: Dinner ₹600, Cab ₹400, Movie ₹240").
 */
export function expenseLinesForPerson(
  personId: string,
  expenses: Expense[],
): ExpenseLineForPerson[] {
  const lines: ExpenseLineForPerson[] = []
  for (const expense of expenses) {
    const share = expense.shares.find((s) => s.personId === personId)
    const paid = expense.payers.find((p) => p.personId === personId)
    if (!share && !paid) continue
    lines.push({
      expenseId: expense.id,
      name: expense.name,
      categoryId: expense.categoryId,
      date: expense.date,
      shareMinor: share?.shareMinor ?? 0,
      paidMinor: paid?.amountMinor ?? 0,
    })
  }
  return lines.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

export interface CategoryTotal {
  categoryId: string
  totalMinor: number
  count: number
}

export function totalsByCategory(expenses: Expense[]): CategoryTotal[] {
  const totals = new Map<string, CategoryTotal>()
  for (const expense of expenses) {
    let row = totals.get(expense.categoryId)
    if (!row) {
      row = { categoryId: expense.categoryId, totalMinor: 0, count: 0 }
      totals.set(expense.categoryId, row)
    }
    row.totalMinor += expense.amountMinor
    row.count += 1
  }
  return [...totals.values()].sort((a, b) => b.totalMinor - a.totalMinor)
}
