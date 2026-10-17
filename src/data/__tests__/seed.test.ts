import { describe, expect, it } from 'vitest'
import { computeBalances, totalNet } from '@/domain/balances'
import { buildSettlement } from '@/domain/settlement'
import { sumMinor } from '@/domain/money'
import { buildDemoBundle } from '../seed'

describe('demo Goa trip', () => {
  const bundle = buildDemoBundle()

  it('has 5 people and 8 expenses', () => {
    expect(bundle.people).toHaveLength(5)
    expect(bundle.expenses).toHaveLength(8)
  })

  it('has shares that sum exactly to each expense amount', () => {
    for (const expense of bundle.expenses) {
      expect(sumMinor(expense.shares.map((s) => s.shareMinor))).toBe(expense.amountMinor)
      expect(sumMinor(expense.payers.map((p) => p.amountMinor))).toBe(expense.amountMinor)
    }
  })

  it('nets to exactly zero — the acceptance invariant', () => {
    expect(totalNet(computeBalances(bundle.people, bundle.expenses, bundle.payments))).toBe(0)
  })

  it('exercises the awkward cases', () => {
    expect(bundle.expenses.some((e) => e.payers.length > 1)).toBe(true)
    expect(bundle.expenses.some((e) => e.amountMinor < 0)).toBe(true)
    expect(bundle.expenses.some((e) => e.splitType === 'shares')).toBe(true)
    expect(bundle.expenses.some((e) => e.shares.length < bundle.people.length)).toBe(true)
    // An amount that does not divide evenly across 5 people.
    expect(bundle.expenses.some((e) => e.amountMinor % bundle.people.length !== 0)).toBe(true)
  })

  it('opens with a partial payment so all three statuses are visible', () => {
    const view = buildSettlement(
      bundle.people,
      bundle.expenses,
      bundle.payments,
      'collector',
      bundle.plan.organizerId,
    )
    expect(view.obligations.some((o) => o.status === 'partial')).toBe(true)
    expect(view.settled).toBe(false)
  })

  it('satisfies paid + remaining === original dues in both modes', () => {
    for (const mode of ['collector', 'minimal'] as const) {
      const view = buildSettlement(
        bundle.people,
        bundle.expenses,
        bundle.payments,
        mode,
        bundle.plan.organizerId,
      )
      expect(view.totalPaidMinor + view.totalRemainingMinor).toBe(view.totalDueMinor)
    }
  })

  it('settles completely once every obligation is paid', () => {
    const view = buildSettlement(
      bundle.people,
      bundle.expenses,
      bundle.payments,
      'collector',
      bundle.plan.organizerId,
    )
    const topUps = view.obligations
      .filter((o) => o.remainingMinor > 0)
      .map((o, i) => ({
        id: `top_${i}`,
        planId: bundle.plan.id,
        fromPersonId: o.fromPersonId,
        toPersonId: o.toPersonId,
        amountMinor: o.remainingMinor,
        method: 'upi' as const,
        date: '2026-02-20',
        createdAt: '2026-02-20T00:00:00.000Z',
      }))

    const final = buildSettlement(
      bundle.people,
      bundle.expenses,
      [...bundle.payments, ...topUps],
      'collector',
      bundle.plan.organizerId,
    )
    expect(final.settled).toBe(true)
  })
})
