import { describe, expect, it } from 'vitest'
import { computeBalances, netsFrom } from '../balances'
import { buildSettlement, settleCollector, settleMinimal } from '../settlement'
import { expense, payment, person } from './factories'

const rahul = person('Rahul')
const anu = person('Anu')
const vikram = person('Vikram')
const priya = person('Priya')
const people = [rahul, anu, vikram, priya]

const nets = (entries: Record<string, number>) => new Map(Object.entries(entries))
const sumTransfers = (ts: { amountMinor: number }[]) => ts.reduce((a, t) => a + t.amountMinor, 0)

describe('settleMinimal', () => {
  it('matches the largest debtor to the largest creditor', () => {
    const transfers = settleMinimal(nets({ rahul: 60000, anu: -40000, vikram: -20000 }))
    expect(transfers).toEqual([
      { fromPersonId: 'anu', toPersonId: 'rahul', amountMinor: 40000 },
      { fromPersonId: 'vikram', toPersonId: 'rahul', amountMinor: 20000 },
    ])
  })

  it('needs at most n-1 transfers', () => {
    const transfers = settleMinimal(
      nets({ a: 50000, b: 30000, c: -20000, d: -25000, e: -35000 }),
    )
    expect(transfers.length).toBeLessThanOrEqual(4)
  })

  it('beats the naive everyone-pays-everyone count', () => {
    // 4 people, 2 creditors and 2 debtors that pair off exactly.
    const transfers = settleMinimal(nets({ a: 10000, b: 10000, c: -10000, d: -10000 }))
    expect(transfers).toHaveLength(2)
  })

  it('conserves money: transfers equal total debt', () => {
    const balances = nets({ a: 73451, b: -21200, c: -33333, d: -18918 })
    const transfers = settleMinimal(balances)
    expect(sumTransfers(transfers)).toBe(73451)
  })

  it('leaves zero-balance people out entirely', () => {
    const transfers = settleMinimal(nets({ a: 10000, b: -10000, c: 0 }))
    expect(transfers).toHaveLength(1)
    expect(transfers.some((t) => t.fromPersonId === 'c' || t.toPersonId === 'c')).toBe(false)
  })

  it('returns nothing when everyone is square', () => {
    expect(settleMinimal(nets({ a: 0, b: 0 }))).toEqual([])
  })

  it('is deterministic when amounts tie', () => {
    const balances = nets({ a: 10000, b: 10000, c: -10000, d: -10000 })
    expect(settleMinimal(balances)).toEqual(settleMinimal(balances))
  })

  it('settles the balance sheet to zero when applied', () => {
    const expenses = [
      expense({ name: 'Dinner', amountMinor: 240050, paidBy: 'rahul', involved: ['rahul', 'anu', 'vikram', 'priya'] }),
      expense({ name: 'Cab', amountMinor: 70000, paidBy: 'anu', involved: ['anu', 'vikram'] }),
    ]
    const sheet = computeBalances(people, expenses)
    const transfers = settleMinimal(netsFrom(sheet, 'netFromExpensesMinor'))

    const applied = computeBalances(
      people,
      expenses,
      transfers.map((t) => payment(t.fromPersonId, t.toPersonId, t.amountMinor)),
    )
    for (const row of applied.values()) expect(row.netMinor).toBe(0)
  })
})

describe('settleCollector', () => {
  it('routes every transfer through the organizer', () => {
    const transfers = settleCollector(nets({ rahul: 60000, anu: -40000, vikram: -20000 }), 'rahul')
    expect(transfers).toEqual([
      { fromPersonId: 'anu', toPersonId: 'rahul', amountMinor: 40000 },
      { fromPersonId: 'vikram', toPersonId: 'rahul', amountMinor: 20000 },
    ])
    expect(transfers.every((t) => t.fromPersonId === 'rahul' || t.toPersonId === 'rahul')).toBe(true)
  })

  it('pays out to people who are owed, as well as collecting', () => {
    // Anu fronted money, so the organizer owes her.
    const transfers = settleCollector(nets({ rahul: -10000, anu: 30000, vikram: -20000 }), 'rahul')
    expect(transfers).toContainEqual({ fromPersonId: 'rahul', toPersonId: 'anu', amountMinor: 30000 })
    expect(transfers).toContainEqual({ fromPersonId: 'vikram', toPersonId: 'rahul', amountMinor: 20000 })
    // The organizer's own -10000 is the balancing item, never its own transfer.
    expect(transfers).toHaveLength(2)
  })

  it('gives every non-organizer exactly one figure to remember', () => {
    const transfers = settleCollector(
      nets({ rahul: 73451, anu: -21200, vikram: -33333, priya: -18918 }),
      'rahul',
    )
    for (const id of ['anu', 'vikram', 'priya']) {
      expect(transfers.filter((t) => t.fromPersonId === id || t.toPersonId === id)).toHaveLength(1)
    }
  })

  it('omits people who are already square', () => {
    const transfers = settleCollector(nets({ rahul: 10000, anu: -10000, vikram: 0 }), 'rahul')
    expect(transfers).toHaveLength(1)
  })

  it('settles the balance sheet to zero when applied', () => {
    const expenses = [
      expense({ name: 'Stay', amountMinor: 1000003, paidBy: 'rahul', involved: ['rahul', 'anu', 'vikram', 'priya'] }),
      expense({ name: 'Fuel', amountMinor: 253300, paidBy: 'priya', involved: ['rahul', 'anu', 'vikram', 'priya'] }),
    ]
    const sheet = computeBalances(people, expenses)
    const transfers = settleCollector(netsFrom(sheet, 'netFromExpensesMinor'), 'rahul')

    const applied = computeBalances(
      people,
      expenses,
      transfers.map((t) => payment(t.fromPersonId, t.toPersonId, t.amountMinor)),
    )
    for (const row of applied.values()) expect(row.netMinor).toBe(0)
  })
})

describe('buildSettlement — payment tracking', () => {
  const expenses = [
    expense({ name: 'Dinner', amountMinor: 120000, paidBy: 'rahul', involved: ['rahul', 'anu', 'vikram'] }),
  ]

  it('starts every obligation pending', () => {
    const view = buildSettlement(people, expenses, [], 'collector', 'rahul')
    expect(view.obligations.every((o) => o.status === 'pending')).toBe(true)
    expect(view.totalDueMinor).toBe(80000)
    expect(view.settled).toBe(false)
  })

  it('marks an obligation partial after a partial payment', () => {
    const view = buildSettlement(people, expenses, [payment('anu', 'rahul', 10000)], 'collector', 'rahul')
    const anuRow = view.obligations.find((o) => o.fromPersonId === 'anu')!

    expect(anuRow.status).toBe('partial')
    expect(anuRow.paidMinor).toBe(10000)
    expect(anuRow.remainingMinor).toBe(30000)
  })

  it('marks an obligation paid when fully covered', () => {
    const view = buildSettlement(people, expenses, [payment('anu', 'rahul', 40000)], 'collector', 'rahul')
    const anuRow = view.obligations.find((o) => o.fromPersonId === 'anu')!

    expect(anuRow.status).toBe('paid')
    expect(anuRow.remainingMinor).toBe(0)
    expect(anuRow.creditMinor).toBe(0)
  })

  it('records an over-payment as a credit', () => {
    const view = buildSettlement(people, expenses, [payment('anu', 'rahul', 50000)], 'collector', 'rahul')
    const anuRow = view.obligations.find((o) => o.fromPersonId === 'anu')!

    expect(anuRow.status).toBe('paid')
    expect(anuRow.creditMinor).toBe(10000)

    // The credit shows up as a live positive balance for Anu.
    const sheet = computeBalances(people, expenses, [payment('anu', 'rahul', 50000)])
    expect(sheet.get('anu')!.netMinor).toBe(10000)
  })

  it('accumulates several partial payments', () => {
    const payments = [
      payment('anu', 'rahul', 15000),
      payment('anu', 'rahul', 15000),
      payment('anu', 'rahul', 10000),
    ]
    const view = buildSettlement(people, expenses, payments, 'collector', 'rahul')
    const anuRow = view.obligations.find((o) => o.fromPersonId === 'anu')!

    expect(anuRow.paidMinor).toBe(40000)
    expect(anuRow.status).toBe('paid')
  })

  it('reports the plan settled once every balance is zero', () => {
    const payments = [payment('anu', 'rahul', 40000), payment('vikram', 'rahul', 40000)]
    const view = buildSettlement(people, expenses, payments, 'collector', 'rahul')

    expect(view.settled).toBe(true)
    expect(view.totalRemainingMinor).toBe(0)
  })

  it('surfaces a payment made to someone outside the plan of transfers', () => {
    // Vikram pays Anu directly even though the plan said to pay Rahul.
    const view = buildSettlement(people, expenses, [payment('vikram', 'anu', 40000)], 'collector', 'rahul')
    const stray = view.obligations.find((o) => o.id === 'vikram->anu')!

    expect(stray).toBeDefined()
    expect(stray.creditMinor).toBe(40000)
  })

  describe('acceptance invariant', () => {
    const cases: { label: string; payments: ReturnType<typeof payment>[] }[] = [
      { label: 'no payments', payments: [] },
      { label: 'one partial', payments: [payment('anu', 'rahul', 12345)] },
      { label: 'one settled', payments: [payment('anu', 'rahul', 40000)] },
      {
        label: 'both partial',
        payments: [payment('anu', 'rahul', 11111), payment('vikram', 'rahul', 22222)],
      },
    ]

    for (const mode of ['collector', 'minimal'] as const) {
      for (const { label, payments } of cases) {
        it(`${mode} / ${label}: paid + remaining === original dues`, () => {
          const view = buildSettlement(people, expenses, payments, mode, 'rahul')
          expect(view.totalPaidMinor + view.totalRemainingMinor).toBe(view.totalDueMinor)
        })
      }
    }
  })

  it('keeps the transfer list stable while it is being paid off', () => {
    const before = buildSettlement(people, expenses, [], 'minimal', 'rahul')
    const after = buildSettlement(people, expenses, [payment('anu', 'rahul', 10000)], 'minimal', 'rahul')

    expect(after.obligations.map((o) => o.id)).toEqual(before.obligations.map((o) => o.id))
  })
})

describe('both modes agree on the bottom line', () => {
  it('moves the same total amount of money', () => {
    const expenses = [
      expense({ name: 'Stay', amountMinor: 1200000, paidBy: 'rahul', involved: ['rahul', 'anu', 'vikram', 'priya'] }),
      expense({ name: 'Fuel', amountMinor: 253300, paidBy: 'priya', involved: ['rahul', 'anu', 'vikram', 'priya'] }),
      expense({ name: 'Dinner', amountMinor: 487700, paidBy: 'anu', involved: ['anu', 'vikram'] }),
    ]
    const balances = netsFrom(computeBalances(people, expenses), 'netFromExpensesMinor')

    const collectorTotal = sumTransfers(settleCollector(balances, 'rahul'))
    const minimalTotal = sumTransfers(settleMinimal(balances))

    // Minimal mode can never move more money than collector mode, because it
    // cancels out debts that would otherwise round-trip through the organizer.
    expect(minimalTotal).toBeLessThanOrEqual(collectorTotal)

    // Both leave everyone at zero.
    for (const transfers of [settleCollector(balances, 'rahul'), settleMinimal(balances)]) {
      const applied = computeBalances(
        people,
        expenses,
        transfers.map((t) => payment(t.fromPersonId, t.toPersonId, t.amountMinor)),
      )
      for (const row of applied.values()) expect(row.netMinor).toBe(0)
    }
  })
})
