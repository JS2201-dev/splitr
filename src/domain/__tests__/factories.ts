import type { Expense, Payment, Person, SplitType } from '../types'
import { computeShares, normalisePayers } from '../split'

let counter = 0
const nextId = (prefix: string) => `${prefix}-${++counter}`

export function resetIds() {
  counter = 0
}

export function person(name: string, overrides: Partial<Person> = {}): Person {
  return {
    id: overrides.id ?? name.toLowerCase(),
    planId: 'plan-1',
    name,
    role: 'attendee',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * Build a fully-resolved expense the way the app does: run the split engine,
 * so tests exercise the same path the UI does rather than hand-written shares.
 */
export function expense(params: {
  name: string
  amountMinor: number
  paidBy: string | { personId: string; amountMinor: number }[]
  involved: string[] | { personId: string; value?: number }[]
  splitType?: SplitType
  date?: string
  categoryId?: string
  id?: string
}): Expense {
  const splitType: SplitType = params.splitType ?? 'equal'
  const participants = (params.involved as (string | { personId: string; value?: number })[]).map(
    (p) => (typeof p === 'string' ? { personId: p } : p),
  )

  const { shares } = computeShares(params.amountMinor, splitType, participants)
  const payers = normalisePayers(
    params.amountMinor,
    typeof params.paidBy === 'string' ? [{ personId: params.paidBy }] : params.paidBy,
  )

  return {
    id: params.id ?? nextId('exp'),
    planId: 'plan-1',
    name: params.name,
    categoryId: params.categoryId ?? 'cat-misc',
    amountMinor: params.amountMinor,
    date: params.date ?? '2026-01-10',
    splitType,
    createdBy: 'system',
    source: 'manual',
    createdAt: '2026-01-10T00:00:00.000Z',
    updatedAt: '2026-01-10T00:00:00.000Z',
    payers,
    shares,
  }
}

export function payment(
  fromPersonId: string,
  toPersonId: string,
  amountMinor: number,
  overrides: Partial<Payment> = {},
): Payment {
  return {
    id: overrides.id ?? nextId('pay'),
    planId: 'plan-1',
    fromPersonId,
    toPersonId,
    amountMinor,
    method: 'upi',
    date: '2026-01-20',
    createdAt: '2026-01-20T00:00:00.000Z',
    ...overrides,
  }
}
