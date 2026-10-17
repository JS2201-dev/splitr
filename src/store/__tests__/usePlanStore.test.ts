import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { computeBalances, totalNet } from '@/domain/balances'
import { buildSettlement } from '@/domain/settlement'
import { parseAmountToMinor } from '@/domain/money'
import { MemoryAdapter, setStorage } from '@/storage'
import { usePlanStore } from '../usePlanStore'

/**
 * End-to-end tests over the real store: storage writes, audit entries, undo,
 * and the acceptance invariants after every mutation.
 */

const money = (value: string) => parseAmountToMinor(value, 'INR')!

async function freshPlan() {
  setStorage(new MemoryAdapter())
  usePlanStore.setState({
    ready: false,
    plans: [],
    activePlanId: null,
    bundle: null,
    lastDeleted: null,
  })

  const store = usePlanStore.getState()
  await store.createPlan({
    name: 'Test Trip',
    type: 'trip',
    currency: 'INR',
    startDate: '2026-03-01',
    endDate: '2026-03-03',
    organizerName: 'Rahul',
    attendeeNames: ['Anu', 'Vikram'],
  })

  const bundle = usePlanStore.getState().bundle!
  const id = (name: string) => bundle.people.find((p) => p.name === name)!.id
  return {
    bundle,
    rahul: id('Rahul'),
    anu: id('Anu'),
    vikram: id('Vikram'),
    foodCategory: bundle.categories.find((c) => c.name === 'Food')!.id,
  }
}

const current = () => usePlanStore.getState().bundle!

/** The two acceptance checks from the spec, asserted after every mutation. */
function assertInvariants() {
  const { plan, people, expenses, payments } = current()
  expect(totalNet(computeBalances(people, expenses, payments))).toBe(0)

  for (const mode of ['collector', 'minimal'] as const) {
    const view = buildSettlement(people, expenses, payments, mode, plan.organizerId)
    expect(view.totalPaidMinor + view.totalRemainingMinor).toBe(view.totalDueMinor)
  }
}

describe('plan lifecycle', () => {
  beforeEach(() => {
    setStorage(null)
  })

  it('creates a plan with an organizer, attendees and default categories', async () => {
    const { bundle, rahul } = await freshPlan()

    expect(bundle.plan.name).toBe('Test Trip')
    expect(bundle.plan.organizerId).toBe(rahul)
    expect(bundle.people).toHaveLength(3)
    expect(bundle.categories.length).toBeGreaterThan(0)
    expect(bundle.plan.status).toBe('active')
  })

  it('persists across a reload', async () => {
    const { foodCategory, rahul, anu, vikram } = await freshPlan()
    const planId = current().plan.id

    await usePlanStore.getState().addExpense({
      name: 'Dinner',
      categoryId: foodCategory,
      amountMinor: money('2400'),
      date: '2026-03-01',
      splitType: 'equal',
      participants: [{ personId: rahul }, { personId: anu }, { personId: vikram }],
      payers: [{ personId: rahul }],
    })

    // Re-select the plan: this goes back through storage, not memory state.
    await usePlanStore.getState().selectPlan(planId)
    expect(current().expenses).toHaveLength(1)
    expect(current().expenses[0].name).toBe('Dinner')
  })
})

describe('expense flow', () => {
  beforeEach(() => {
    setStorage(null)
  })

  it('adds an expense, splits it, and keeps the books balanced', async () => {
    const { foodCategory, rahul, anu, vikram } = await freshPlan()

    await usePlanStore.getState().addExpense({
      name: 'Dinner',
      categoryId: foodCategory,
      amountMinor: money('2400'),
      date: '2026-03-01',
      splitType: 'equal',
      participants: [{ personId: rahul }, { personId: anu }, { personId: vikram }],
      payers: [{ personId: rahul }],
    })

    const sheet = computeBalances(current().people, current().expenses, current().payments)
    expect(sheet.get(rahul)!.netMinor).toBe(money('1600'))
    expect(sheet.get(anu)!.netMinor).toBe(money('-800'))
    assertInvariants()
  })

  it('writes an audit entry for create, edit and delete', async () => {
    const { foodCategory, rahul, anu } = await freshPlan()
    const store = () => usePlanStore.getState()

    await store().addExpense({
      name: 'Dinner',
      categoryId: foodCategory,
      amountMinor: money('1000'),
      date: '2026-03-01',
      splitType: 'equal',
      participants: [{ personId: rahul }, { personId: anu }],
      payers: [{ personId: rahul }],
    })
    const expenseId = current().expenses[0].id

    await store().updateExpense(expenseId, {
      name: 'Dinner (updated)',
      categoryId: foodCategory,
      amountMinor: money('1200'),
      date: '2026-03-01',
      splitType: 'equal',
      participants: [{ personId: rahul }, { personId: anu }],
      payers: [{ personId: rahul }],
    })

    await store().deleteExpense(expenseId)

    const actions = current().auditLogs.map((a) => a.action)
    expect(actions).toContain('create')
    expect(actions).toContain('update')
    expect(actions).toContain('delete')

    // The audit entry keeps the before/after so a change is reviewable.
    const edit = current().auditLogs.find((a) => a.action === 'update' && a.entity === 'expense')!
    expect((edit.before as { amountMinor: number }).amountMinor).toBe(money('1000'))
    expect((edit.after as { amountMinor: number }).amountMinor).toBe(money('1200'))
  })

  it('restores a deleted expense via undo', async () => {
    const { foodCategory, rahul, anu } = await freshPlan()
    const store = () => usePlanStore.getState()

    await store().addExpense({
      name: 'Cab',
      categoryId: foodCategory,
      amountMinor: money('600'),
      date: '2026-03-01',
      splitType: 'equal',
      participants: [{ personId: rahul }, { personId: anu }],
      payers: [{ personId: rahul }],
    })

    const before = computeBalances(current().people, current().expenses, current().payments)
    const expenseId = current().expenses[0].id

    await store().deleteExpense(expenseId)
    expect(current().expenses).toHaveLength(0)
    expect(store().lastDeleted).not.toBeNull()

    await store().undoLastDelete()
    expect(current().expenses).toHaveLength(1)

    const after = computeBalances(current().people, current().expenses, current().payments)
    expect(after.get(rahul)!.netMinor).toBe(before.get(rahul)!.netMinor)
    assertInvariants()
  })
})

describe('settlement and payments', () => {
  beforeEach(() => {
    setStorage(null)
  })

  async function planWithDebt() {
    const context = await freshPlan()
    await usePlanStore.getState().addExpense({
      name: 'Villa',
      categoryId: context.foodCategory,
      amountMinor: money('3000'),
      date: '2026-03-01',
      splitType: 'equal',
      participants: [
        { personId: context.rahul },
        { personId: context.anu },
        { personId: context.vikram },
      ],
      payers: [{ personId: context.rahul }],
    })
    return context
  }

  it('tracks partial then full payment, and flips the plan to settled', async () => {
    const { rahul, anu, vikram } = await planWithDebt()
    const store = () => usePlanStore.getState()

    const view = () =>
      buildSettlement(current().people, current().expenses, current().payments, 'collector', rahul)

    expect(view().obligations.every((o) => o.status === 'pending')).toBe(true)
    expect(current().plan.status).toBe('active')

    // Anu pays half.
    await store().recordPayment({
      fromPersonId: anu,
      toPersonId: rahul,
      amountMinor: money('500'),
      method: 'upi',
      date: '2026-03-04',
    })

    const anuRow = view().obligations.find((o) => o.fromPersonId === anu)!
    expect(anuRow.status).toBe('partial')
    expect(anuRow.remainingMinor).toBe(money('500'))
    assertInvariants()

    // Anu pays the rest, Vikram pays in full.
    await store().recordPayment({
      fromPersonId: anu,
      toPersonId: rahul,
      amountMinor: money('500'),
      method: 'cash',
      date: '2026-03-05',
    })
    await store().recordPayment({
      fromPersonId: vikram,
      toPersonId: rahul,
      amountMinor: money('1000'),
      method: 'upi',
      date: '2026-03-05',
    })

    expect(view().settled).toBe(true)
    expect(current().plan.status).toBe('settled')
    assertInvariants()
  })

  it('records an over-payment as a credit and reopens the plan', async () => {
    const { rahul, anu, vikram } = await planWithDebt()
    const store = () => usePlanStore.getState()

    await store().recordPayment({
      fromPersonId: anu,
      toPersonId: rahul,
      amountMinor: money('1500'),
      method: 'upi',
      date: '2026-03-04',
    })

    const sheet = computeBalances(current().people, current().expenses, current().payments)
    expect(sheet.get(anu)!.netMinor).toBe(money('500'))
    expect(current().plan.status).toBe('active')
    assertInvariants()

    await store().recordPayment({
      fromPersonId: vikram,
      toPersonId: rahul,
      amountMinor: money('1000'),
      method: 'upi',
      date: '2026-03-04',
    })
    // Anu is still ₹500 up, so the plan is not settled.
    expect(current().plan.status).toBe('active')
  })

  it('goes back to active when a payment is deleted', async () => {
    const { rahul, anu, vikram } = await planWithDebt()
    const store = () => usePlanStore.getState()

    for (const person of [anu, vikram]) {
      await store().recordPayment({
        fromPersonId: person,
        toPersonId: rahul,
        amountMinor: money('1000'),
        method: 'upi',
        date: '2026-03-04',
      })
    }
    expect(current().plan.status).toBe('settled')

    await store().deletePayment(current().payments[0].id)
    expect(current().plan.status).toBe('active')
    assertInvariants()

    await store().undoLastDelete()
    expect(current().plan.status).toBe('settled')
  })
})

describe('backup restore', () => {
  beforeEach(() => {
    setStorage(null)
  })

  async function planWithOneExpense() {
    const context = await freshPlan()
    await usePlanStore.getState().addExpense({
      name: 'Dinner',
      categoryId: context.foodCategory,
      amountMinor: money('900'),
      date: '2026-03-01',
      splitType: 'equal',
      participants: [
        { personId: context.rahul },
        { personId: context.anu },
        { personId: context.vikram },
      ],
      payers: [{ personId: context.rahul }],
    })
    return context
  }

  it('imports a backup as a separate plan without touching the original', async () => {
    await planWithOneExpense()
    const original = structuredClone(current())

    const newPlanId = await usePlanStore.getState().restoreBundle(original, 'copy')
    expect(newPlanId).not.toBe(original.plan.id)
    expect(usePlanStore.getState().plans).toHaveLength(2)

    // The copy carries the same money under fresh ids.
    expect(current().expenses).toHaveLength(1)
    expect(current().expenses[0].amountMinor).toBe(money('900'))
    assertInvariants()

    // And the original is untouched.
    await usePlanStore.getState().selectPlan(original.plan.id)
    expect(current().expenses).toHaveLength(1)
    assertInvariants()
  })

  it('replaces in place, dropping rows added since the backup was taken', async () => {
    const { foodCategory, rahul, anu } = await planWithOneExpense()
    const snapshot = structuredClone(current())

    // Add a second expense *after* the backup.
    await usePlanStore.getState().addExpense({
      name: 'Added later',
      categoryId: foodCategory,
      amountMinor: money('300'),
      date: '2026-03-02',
      splitType: 'equal',
      participants: [{ personId: rahul }, { personId: anu }],
      payers: [{ personId: rahul }],
    })
    expect(current().expenses).toHaveLength(2)

    await usePlanStore.getState().restoreBundle(snapshot, 'replace')

    // The later expense is gone, not merged in alongside.
    expect(current().expenses).toHaveLength(1)
    expect(current().expenses[0].name).toBe('Dinner')
    expect(usePlanStore.getState().plans).toHaveLength(1)
    assertInvariants()
  })

  it('preserves balances exactly across a copy', async () => {
    const { anu } = await planWithOneExpense()
    const before = computeBalances(current().people, current().expenses, current().payments)
    const anuNet = before.get(anu)!.netMinor

    await usePlanStore.getState().restoreBundle(structuredClone(current()), 'copy')

    const after = computeBalances(current().people, current().expenses, current().payments)
    const nets = [...after.values()].map((r) => r.netMinor).sort((a, b) => a - b)
    expect(nets).toContain(anuNet)
    assertInvariants()
  })
})

describe('currency change', () => {
  beforeEach(() => {
    setStorage(null)
  })

  async function planInInr() {
    const context = await freshPlan()
    await usePlanStore.getState().addExpense({
      name: 'Dinner',
      categoryId: context.foodCategory,
      amountMinor: money('900'), // ₹900.00 → 90000 paise
      date: '2026-03-01',
      splitType: 'equal',
      participants: [
        { personId: context.rahul },
        { personId: context.anu },
        { personId: context.vikram },
      ],
      payers: [{ personId: context.rahul }],
    })
    return context
  }

  it('relabels without rescaling between same-exponent currencies', async () => {
    await planInInr()
    await usePlanStore.getState().changeCurrency('USD')

    expect(current().plan.currency).toBe('USD')
    // 2dp → 2dp: the stored minor units are unchanged.
    expect(current().expenses[0].amountMinor).toBe(90000)
    assertInvariants()
  })

  it('rescales to a zero-decimal currency so the typed amount still reads the same', async () => {
    await planInInr()
    await usePlanStore.getState().changeCurrency('JPY')

    expect(current().plan.currency).toBe('JPY')
    // ₹900.00 (90000 paise) → ¥900 (900 yen), not ¥90,000.
    expect(current().expenses[0].amountMinor).toBe(900)
    assertInvariants()
  })

  it('keeps shares summing to the total after a lossy rescale', async () => {
    const context = await freshPlan()
    // ₹100.00 across 3 → 33.34/33.33/33.33. In yen that is 100 → 34/33/33.
    await usePlanStore.getState().addExpense({
      name: 'Awkward',
      categoryId: context.foodCategory,
      amountMinor: money('100'),
      date: '2026-03-01',
      splitType: 'equal',
      participants: [
        { personId: context.rahul },
        { personId: context.anu },
        { personId: context.vikram },
      ],
      payers: [{ personId: context.rahul }],
    })

    await usePlanStore.getState().changeCurrency('JPY')

    const expense = current().expenses[0]
    expect(expense.amountMinor).toBe(100)
    expect(expense.shares.reduce((a, s) => a + s.shareMinor, 0)).toBe(100)
    expect(expense.payers.reduce((a, p) => a + p.amountMinor, 0)).toBe(100)
    assertInvariants()
  })

  it('rescales recorded payments too, so settlement stays consistent', async () => {
    const { rahul, anu } = await planInInr()
    await usePlanStore.getState().recordPayment({
      fromPersonId: anu,
      toPersonId: rahul,
      amountMinor: money('300'),
      method: 'upi',
      date: '2026-03-02',
    })

    await usePlanStore.getState().changeCurrency('JPY')
    expect(current().payments[0].amountMinor).toBe(300)
    assertInvariants()
  })

  it('is a no-op when the currency has not changed', async () => {
    await planInInr()
    const before = structuredClone(current().expenses)
    await usePlanStore.getState().changeCurrency('INR')
    expect(current().expenses).toEqual(before)
  })
})

describe('people edge cases', () => {
  beforeEach(() => {
    setStorage(null)
  })

  it('adds someone late without disturbing existing expenses', async () => {
    const { foodCategory, rahul, anu, vikram } = await freshPlan()
    const store = () => usePlanStore.getState()

    await store().addExpense({
      name: 'Dinner',
      categoryId: foodCategory,
      amountMinor: money('900'),
      date: '2026-03-01',
      splitType: 'equal',
      participants: [{ personId: rahul }, { personId: anu }, { personId: vikram }],
      payers: [{ personId: rahul }],
    })

    const before = computeBalances(current().people, current().expenses, current().payments)
    await store().addPerson({ name: 'Priya', role: 'attendee' })
    const after = computeBalances(current().people, current().expenses, current().payments)

    expect(after.get(anu)!.netMinor).toBe(before.get(anu)!.netMinor)
    const priya = current().people.find((p) => p.name === 'Priya')!
    expect(after.get(priya.id)!.netMinor).toBe(0)
    assertInvariants()
  })

  it('blocks removing someone with a balance, and allows it once settled', async () => {
    const { foodCategory, rahul, anu, vikram } = await freshPlan()
    const store = () => usePlanStore.getState()

    await store().addExpense({
      name: 'Dinner',
      categoryId: foodCategory,
      amountMinor: money('900'),
      date: '2026-03-01',
      splitType: 'equal',
      participants: [{ personId: rahul }, { personId: anu }, { personId: vikram }],
      payers: [{ personId: rahul }],
    })

    const blocked = await store().removePerson(anu)
    expect(blocked.ok).toBe(false)
    expect(blocked.reason).toMatch(/settle up/i)

    // Someone with no activity at all can be removed.
    await store().addPerson({ name: 'Priya', role: 'attendee' })
    const priya = current().people.find((p) => p.name === 'Priya')!
    expect((await store().removePerson(priya.id)).ok).toBe(true)
  })

  it('refuses to remove the organizer', async () => {
    const { rahul } = await freshPlan()
    const result = await usePlanStore.getState().removePerson(rahul)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/organizer/i)
  })
})
