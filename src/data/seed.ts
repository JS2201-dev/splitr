import { computeShares, normalisePayers } from '@/domain/split'
import type {
  AuditLog,
  Category,
  Expense,
  Payment,
  Person,
  Plan,
  PlanBundle,
  SplitType,
} from '@/domain/types'
import { DEFAULT_CATEGORIES } from './categories'

export const DEMO_PLAN_ID = 'plan_demo_goa'

/**
 * A 5-person Goa trip with 8 expenses, so the app has something real in it the
 * first time it opens.
 *
 * Ids are fixed rather than generated: re-seeding overwrites the same rows
 * instead of piling up duplicate demo plans, and the numbers in the README stay
 * true. It deliberately exercises the awkward cases — an uneven ₹ amount that
 * needs paise distributed across 5 people, an expense two people paid for
 * together, one that excludes a person, a weighted split, and a refund.
 */
export function buildDemoBundle(): PlanBundle {
  const planId = DEMO_PLAN_ID
  const createdAt = '2026-02-01T09:00:00.000Z'

  const people: Person[] = [
    { id: 'per_rahul', planId, name: 'Rahul', role: 'attendee', upiId: 'rahul@okhdfcbank', phone: '+91 98400 11111', createdAt },
    { id: 'per_anu', planId, name: 'Anu', role: 'attendee', upiId: 'anu@okaxis', phone: '+91 98400 22222', createdAt },
    { id: 'per_vikram', planId, name: 'Vikram', role: 'attendee', upiId: 'vikram@ybl', createdAt },
    { id: 'per_priya', planId, name: 'Priya', role: 'attendee', upiId: 'priya@okicici', createdAt },
    { id: 'per_sam', planId, name: 'Sam', role: 'attendee', createdAt },
  ]

  const everyone = people.map((p) => p.id)

  const categories: Category[] = DEFAULT_CATEGORIES.map(({ key, name, icon }) => ({
    id: `cat_${key}`,
    planId,
    name,
    icon,
    hidden: false,
  }))

  const plan: Plan = {
    id: planId,
    name: 'Goa Trip',
    type: 'trip',
    currency: 'INR',
    organizerId: 'per_rahul',
    startDate: '2026-02-14',
    endDate: '2026-02-17',
    status: 'active',
    settlementMode: 'collector',
    createdAt,
    updatedAt: createdAt,
  }

  const make = (params: {
    id: string
    name: string
    categoryKey: string
    amountMinor: number
    date: string
    paidBy: string | { personId: string; amountMinor: number }[]
    involved?: (string | { personId: string; value?: number })[]
    splitType?: SplitType
    notes?: string
  }): Expense => {
    const splitType = params.splitType ?? 'equal'
    const participants = (params.involved ?? everyone).map((p) =>
      typeof p === 'string' ? { personId: p } : p,
    )
    const { shares } = computeShares(params.amountMinor, splitType, participants)
    const payers = normalisePayers(
      params.amountMinor,
      typeof params.paidBy === 'string' ? [{ personId: params.paidBy }] : params.paidBy,
    )

    return {
      id: params.id,
      planId,
      name: params.name,
      categoryId: `cat_${params.categoryKey}`,
      amountMinor: params.amountMinor,
      date: params.date,
      notes: params.notes,
      splitType,
      createdBy: 'per_rahul',
      source: 'seed',
      createdAt: `${params.date}T12:00:00.000Z`,
      updatedAt: `${params.date}T12:00:00.000Z`,
      payers,
      shares,
    }
  }

  const expenses: Expense[] = [
    make({
      id: 'exp_demo_1',
      name: 'Beach villa — 3 nights',
      categoryKey: 'stay',
      amountMinor: 4200000, // ₹42,000
      date: '2026-02-14',
      paidBy: 'per_rahul',
      notes: 'Booked on Airbnb, includes breakfast',
    }),
    make({
      id: 'exp_demo_2',
      name: 'Flights (Rahul + Anu pooled)',
      categoryKey: 'travel',
      amountMinor: 3750000, // ₹37,500
      date: '2026-02-14',
      // Two people fronted this one between them.
      paidBy: [
        { personId: 'per_rahul', amountMinor: 2250000 },
        { personId: 'per_anu', amountMinor: 1500000 },
      ],
    }),
    make({
      id: 'exp_demo_3',
      name: 'Dinner at Thalassa',
      categoryKey: 'food',
      // ₹8,734.33 — deliberately indivisible by 5, so the leftover paise have
      // to be distributed and the shares still sum exactly.
      amountMinor: 873433,
      date: '2026-02-14',
      paidBy: 'per_anu',
    }),
    make({
      id: 'exp_demo_4',
      name: 'Scooter rental',
      categoryKey: 'travel',
      amountMinor: 360000, // ₹3,600
      date: '2026-02-15',
      paidBy: 'per_vikram',
      // Sam did not ride.
      involved: ['per_rahul', 'per_anu', 'per_vikram', 'per_priya'],
      notes: 'Sam sat this one out',
    }),
    make({
      id: 'exp_demo_5',
      name: 'Petrol',
      categoryKey: 'fuel',
      amountMinor: 120000, // ₹1,200
      date: '2026-02-15',
      paidBy: 'per_priya',
      involved: ['per_rahul', 'per_anu', 'per_vikram', 'per_priya'],
    }),
    make({
      id: 'exp_demo_6',
      name: 'Water sports — parasailing',
      categoryKey: 'tickets',
      amountMinor: 900000, // ₹9,000
      date: '2026-02-16',
      paidBy: 'per_sam',
      // Priya and Sam went twice, so they carry double weight.
      splitType: 'shares',
      involved: [
        { personId: 'per_rahul', value: 1 },
        { personId: 'per_anu', value: 1 },
        { personId: 'per_vikram', value: 1 },
        { personId: 'per_priya', value: 2 },
        { personId: 'per_sam', value: 2 },
      ],
    }),
    make({
      id: 'exp_demo_7',
      name: 'Groceries & drinks',
      categoryKey: 'shopping',
      amountMinor: 532500, // ₹5,325
      date: '2026-02-16',
      paidBy: 'per_rahul',
    }),
    make({
      id: 'exp_demo_8',
      name: 'Villa damage deposit refund',
      categoryKey: 'stay',
      amountMinor: -500000, // ₹5,000 back
      date: '2026-02-17',
      paidBy: 'per_rahul',
      notes: 'Refunded at checkout — reduces what everyone owes',
    }),
  ]

  // One partial payment already recorded, so the Settle-up tab has all three
  // statuses visible on first open.
  const payments: Payment[] = [
    {
      id: 'pay_demo_1',
      planId,
      fromPersonId: 'per_vikram',
      toPersonId: 'per_rahul',
      amountMinor: 500000, // ₹5,000 of what Vikram owes
      method: 'upi',
      reference: 'UPI/405123456789',
      date: '2026-02-18',
      createdAt: '2026-02-18T10:00:00.000Z',
    },
  ]

  const auditLogs: AuditLog[] = [
    {
      id: 'aud_demo_1',
      planId,
      entity: 'plan',
      entityId: planId,
      action: 'create',
      summary: 'Created the demo Goa Trip plan with 5 people and 8 expenses',
      actor: 'system',
      at: createdAt,
    },
  ]

  return { plan, people, categories, expenses, payments, auditLogs }
}
