import { allocate, sumMinor } from './money'
import type { ExpenseShare, SplitType } from './types'

/** One row of the "People Involved" editor, before shares are resolved. */
export interface SplitParticipantInput {
  personId: string
  /**
   * Interpretation depends on the split type:
   * - `equal`   → ignored
   * - `exact`   → minor units this person owes
   * - `percent` → percentage points (must total 100)
   * - `shares`  → relative weight (any positive number)
   */
  value?: number
}

export interface SplitResult {
  shares: ExpenseShare[]
}

export class SplitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SplitError'
  }
}

/** Percentages are compared with a small tolerance so 33.33×3 is accepted. */
const PERCENT_TOLERANCE = 0.01

/**
 * Resolve a split rule into concrete per-person amounts.
 *
 * Guarantees, for every split type: `sum(shares) === amountMinor` exactly.
 * This is the invariant the whole balance sheet rests on.
 */
export function computeShares(
  amountMinor: number,
  splitType: SplitType,
  participants: SplitParticipantInput[],
): SplitResult {
  if (!Number.isInteger(amountMinor)) {
    throw new SplitError('Amount must be an integer number of minor units')
  }
  if (participants.length === 0) {
    throw new SplitError('At least one person must be involved in the split')
  }

  const ids = participants.map((p) => p.personId)
  if (new Set(ids).size !== ids.length) {
    throw new SplitError('The same person appears twice in the split')
  }

  switch (splitType) {
    case 'equal':
      return equalSplit(amountMinor, participants)
    case 'exact':
      return exactSplit(amountMinor, participants)
    case 'percent':
      return percentSplit(amountMinor, participants)
    case 'shares':
      return sharesSplit(amountMinor, participants)
  }
}

function equalSplit(amountMinor: number, participants: SplitParticipantInput[]): SplitResult {
  const weights = participants.map(() => 1)
  const amounts = allocate(
    amountMinor,
    weights,
    participants.map((p) => p.personId),
  )
  return {
    shares: participants.map((p, i) => ({ personId: p.personId, shareMinor: amounts[i] })),
  }
}

function exactSplit(amountMinor: number, participants: SplitParticipantInput[]): SplitResult {
  const amounts = participants.map((p) => {
    const value = p.value ?? 0
    if (!Number.isInteger(value)) {
      throw new SplitError('Exact amounts must be whole minor units')
    }
    return value
  })

  const total = sumMinor(amounts)
  if (total !== amountMinor) {
    throw new SplitError(
      `Exact amounts total ${total} but the expense is ${amountMinor} — they must match`,
    )
  }

  return {
    shares: participants.map((p, i) => ({
      personId: p.personId,
      shareMinor: amounts[i],
      weightOrPercent: amounts[i],
    })),
  }
}

function percentSplit(amountMinor: number, participants: SplitParticipantInput[]): SplitResult {
  const percents = participants.map((p) => {
    const value = p.value ?? 0
    if (!Number.isFinite(value) || value < 0) {
      throw new SplitError('Percentages must be non-negative numbers')
    }
    return value
  })

  const total = percents.reduce((a, b) => a + b, 0)
  if (Math.abs(total - 100) > PERCENT_TOLERANCE) {
    throw new SplitError(`Percentages total ${total.toFixed(2)}% — they must add up to 100%`)
  }

  // Allocate against the raw percentages rather than pre-converting to amounts:
  // largest-remainder on the weights keeps the sum exact even when the
  // percentages themselves don't divide cleanly.
  const amounts = allocate(
    amountMinor,
    percents,
    participants.map((p) => p.personId),
  )

  return {
    shares: participants.map((p, i) => ({
      personId: p.personId,
      shareMinor: amounts[i],
      weightOrPercent: percents[i],
    })),
  }
}

function sharesSplit(amountMinor: number, participants: SplitParticipantInput[]): SplitResult {
  const weights = participants.map((p) => {
    const value = p.value ?? 1
    if (!Number.isFinite(value) || value < 0) {
      throw new SplitError('Shares must be non-negative numbers')
    }
    return value
  })

  if (weights.reduce((a, b) => a + b, 0) <= 0) {
    throw new SplitError('At least one person must have a share greater than zero')
  }

  const amounts = allocate(
    amountMinor,
    weights,
    participants.map((p) => p.personId),
  )

  return {
    shares: participants.map((p, i) => ({
      personId: p.personId,
      shareMinor: amounts[i],
      weightOrPercent: weights[i],
    })),
  }
}

/**
 * Resolve who actually paid. A single payer is the common case; multiple payers
 * are supported for the "we split the bill at the counter" situation.
 */
export function normalisePayers(
  amountMinor: number,
  payers: { personId: string; amountMinor?: number }[],
): { personId: string; amountMinor: number }[] {
  if (payers.length === 0) throw new SplitError('An expense needs at least one payer')

  const ids = payers.map((p) => p.personId)
  if (new Set(ids).size !== ids.length) {
    throw new SplitError('The same person appears twice as a payer')
  }

  if (payers.length === 1) {
    return [{ personId: payers[0].personId, amountMinor }]
  }

  const resolved = payers.map((p) => ({
    personId: p.personId,
    amountMinor: p.amountMinor ?? 0,
  }))
  const total = sumMinor(resolved.map((p) => p.amountMinor))
  if (total !== amountMinor) {
    throw new SplitError(
      `Payer amounts total ${total} but the expense is ${amountMinor} — they must match`,
    )
  }
  return resolved
}
