import { computeBalances, netsFrom } from './balances'
import type { Expense, Payment, Person, SettlementMode } from './types'

export interface Transfer {
  fromPersonId: string
  toPersonId: string
  amountMinor: number
}

export type ObligationStatus = 'pending' | 'partial' | 'paid'

export interface Obligation extends Transfer {
  /** Stable id for the directed pair, so UI state survives recalculation. */
  id: string
  /** Total recorded against this pair so far. */
  paidMinor: number
  /** `amountMinor - paidMinor`, floored at zero. */
  remainingMinor: number
  /** Amount paid beyond what was owed. Shows up as a credit. */
  creditMinor: number
  status: ObligationStatus
}

export interface SettlementView {
  mode: SettlementMode
  obligations: Obligation[]
  /** True when nothing is outstanding across the whole plan. */
  settled: boolean
  /** Original total owed, before any payments. */
  totalDueMinor: number
  totalPaidMinor: number
  totalRemainingMinor: number
}

function pairId(from: string, to: string): string {
  return `${from}->${to}`
}

/**
 * Greedy minimal-transfer settlement.
 *
 * Repeatedly match the largest debtor against the largest creditor and move
 * `min(|debt|, credit)` between them. This is the standard heuristic: it is not
 * provably optimal (minimising transactions exactly is NP-hard, equivalent to
 * multi-way partition), but it produces at most `n-1` transfers and in practice
 * matches the true optimum on realistic group sizes. The alternative — exact
 * search — is exponential and not worth it for a trip with eight people.
 *
 * Ties are broken on person id so the output is stable across runs.
 */
export function settleMinimal(nets: Map<string, number>): Transfer[] {
  const debtors: { personId: string; amount: number }[] = []
  const creditors: { personId: string; amount: number }[] = []

  for (const [personId, net] of nets) {
    if (net < 0) debtors.push({ personId, amount: -net })
    else if (net > 0) creditors.push({ personId, amount: net })
  }

  const byAmountThenId = (
    a: { personId: string; amount: number },
    b: { personId: string; amount: number },
  ) => (b.amount !== a.amount ? b.amount - a.amount : a.personId < b.personId ? -1 : 1)

  debtors.sort(byAmountThenId)
  creditors.sort(byAmountThenId)

  const transfers: Transfer[] = []
  let d = 0
  let c = 0

  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d]
    const creditor = creditors[c]
    const amount = Math.min(debtor.amount, creditor.amount)

    if (amount > 0) {
      transfers.push({
        fromPersonId: debtor.personId,
        toPersonId: creditor.personId,
        amountMinor: amount,
      })
    }

    debtor.amount -= amount
    creditor.amount -= amount
    if (debtor.amount === 0) d++
    if (creditor.amount === 0) c++
  }

  return transfers
}

/**
 * Collector mode: everyone squares up with the Organizer and nobody else.
 *
 * More transactions than minimal mode, but exactly one number to remember per
 * person — which is how group trips actually work in practice. The Organizer
 * acts as a clearing house: they collect from everyone who owes, and pay out
 * to everyone who fronted money.
 *
 * The Organizer's own net is the balancing item, so it is never a transfer.
 */
export function settleCollector(nets: Map<string, number>, organizerId: string): Transfer[] {
  const transfers: Transfer[] = []
  const others = [...nets.keys()].filter((id) => id !== organizerId).sort()

  for (const personId of others) {
    const net = nets.get(personId) ?? 0
    if (net < 0) {
      transfers.push({ fromPersonId: personId, toPersonId: organizerId, amountMinor: -net })
    } else if (net > 0) {
      transfers.push({ fromPersonId: organizerId, toPersonId: personId, amountMinor: net })
    }
  }

  return transfers
}

export function settle(
  nets: Map<string, number>,
  mode: SettlementMode,
  organizerId: string,
): Transfer[] {
  return mode === 'collector' ? settleCollector(nets, organizerId) : settleMinimal(nets)
}

/**
 * The Settle-up tab's data source.
 *
 * The obligation list is derived from balances *before* payments, then each
 * directed pair is credited with whatever has actually been recorded against
 * it. Deriving from pre-payment balances is deliberate: it keeps the list of
 * who-pays-whom stable while people are paying it off, instead of silently
 * re-planning the transfers out from under them after every partial payment.
 *
 * It also makes the acceptance check hold by construction:
 *   sum(recorded payments) + sum(remaining) === sum(original dues)
 */
export function buildSettlement(
  people: Person[],
  expenses: Expense[],
  payments: Payment[],
  mode: SettlementMode,
  organizerId: string,
): SettlementView {
  const sheet = computeBalances(people, expenses, payments)
  const preNets = netsFrom(sheet, 'netFromExpensesMinor')
  const planned = settle(preNets, mode, organizerId)

  // Sum recorded payments per directed pair.
  const paidByPair = new Map<string, number>()
  for (const payment of payments) {
    const key = pairId(payment.fromPersonId, payment.toPersonId)
    paidByPair.set(key, (paidByPair.get(key) ?? 0) + payment.amountMinor)
  }

  const obligations: Obligation[] = planned.map((transfer) => {
    const id = pairId(transfer.fromPersonId, transfer.toPersonId)
    const paidMinor = paidByPair.get(id) ?? 0
    const remainingMinor = Math.max(0, transfer.amountMinor - paidMinor)
    const creditMinor = Math.max(0, paidMinor - transfer.amountMinor)
    const status: ObligationStatus =
      remainingMinor === 0 ? 'paid' : paidMinor > 0 ? 'partial' : 'pending'

    return { ...transfer, id, paidMinor, remainingMinor, creditMinor, status }
  })

  // Payments between a pair that was never part of the plan (someone paid the
  // wrong person, or overpaid into a new direction) still need to be visible,
  // otherwise the money disappears from the Settle-up tab.
  for (const [key, paidMinor] of paidByPair) {
    if (obligations.some((o) => o.id === key)) continue
    const [fromPersonId, toPersonId] = key.split('->')
    obligations.push({
      id: key,
      fromPersonId,
      toPersonId,
      amountMinor: 0,
      paidMinor,
      remainingMinor: 0,
      creditMinor: paidMinor,
      status: 'paid',
    })
  }

  const totalDueMinor = planned.reduce((a, t) => a + t.amountMinor, 0)
  const totalPaidMinor = obligations.reduce((a, o) => a + Math.min(o.paidMinor, o.amountMinor), 0)
  const totalRemainingMinor = obligations.reduce((a, o) => a + o.remainingMinor, 0)

  let settledAll = true
  for (const row of sheet.values()) {
    if (row.netMinor !== 0) {
      settledAll = false
      break
    }
  }

  return {
    mode,
    obligations,
    settled: settledAll,
    totalDueMinor,
    totalPaidMinor,
    totalRemainingMinor,
  }
}
