import { describe, expect, it } from 'vitest'
import { computeBalances, isSettled, totalNet, totalsByCategory } from '../balances'
import { expense, payment, person } from './factories'

const rahul = person('Rahul')
const anu = person('Anu')
const vikram = person('Vikram')
const people = [rahul, anu, vikram]

describe('computeBalances', () => {
  it('computes paid, share and net for a single expense', () => {
    const expenses = [
      expense({ name: 'Dinner', amountMinor: 240000, paidBy: 'rahul', involved: ['rahul', 'anu', 'vikram'] }),
    ]
    const sheet = computeBalances(people, expenses)

    expect(sheet.get('rahul')).toMatchObject({ paidMinor: 240000, shareMinor: 80000, netMinor: 160000 })
    expect(sheet.get('anu')).toMatchObject({ paidMinor: 0, shareMinor: 80000, netMinor: -80000 })
    expect(sheet.get('vikram')!.netMinor).toBe(-80000)
  })

  it('always nets to exactly zero', () => {
    const expenses = [
      expense({ name: 'Dinner', amountMinor: 240050, paidBy: 'rahul', involved: ['rahul', 'anu', 'vikram'] }),
      expense({ name: 'Cab', amountMinor: 33333, paidBy: 'anu', involved: ['rahul', 'anu'] }),
      expense({ name: 'Movie', amountMinor: 100000, paidBy: 'vikram', involved: ['rahul', 'anu', 'vikram'] }),
    ]
    expect(totalNet(computeBalances(people, expenses))).toBe(0)
  })

  it('nets to zero after payments too', () => {
    const expenses = [
      expense({ name: 'Dinner', amountMinor: 100000, paidBy: 'rahul', involved: ['rahul', 'anu', 'vikram'] }),
    ]
    const payments = [payment('anu', 'rahul', 20000), payment('vikram', 'rahul', 33333)]
    expect(totalNet(computeBalances(people, expenses, payments))).toBe(0)
  })

  it('includes people with no expenses at a zero balance', () => {
    const sheet = computeBalances(people, [
      expense({ name: 'Snacks', amountMinor: 20000, paidBy: 'rahul', involved: ['rahul'] }),
    ])
    expect(sheet.get('anu')!.netMinor).toBe(0)
    expect(sheet.get('vikram')!.netMinor).toBe(0)
  })

  it('leaves earlier expenses untouched when a person is added later', () => {
    const before = [
      expense({ name: 'Dinner', amountMinor: 90000, paidBy: 'rahul', involved: ['rahul', 'anu', 'vikram'] }),
    ]
    const priya = person('Priya')
    const sheet = computeBalances([...people, priya], before)

    expect(sheet.get('priya')!.netMinor).toBe(0)
    expect(sheet.get('anu')!.netMinor).toBe(-30000)
    expect(totalNet(sheet)).toBe(0)
  })

  it('handles a payer who is not part of the split', () => {
    // Rahul pays for a meal he did not eat.
    const expenses = [
      expense({ name: 'Treat', amountMinor: 60000, paidBy: 'rahul', involved: ['anu', 'vikram'] }),
    ]
    const sheet = computeBalances(people, expenses)

    expect(sheet.get('rahul')).toMatchObject({ paidMinor: 60000, shareMinor: 0, netMinor: 60000 })
    expect(sheet.get('anu')!.netMinor).toBe(-30000)
    expect(totalNet(sheet)).toBe(0)
  })

  it('handles an expense the organizer paid for only themselves', () => {
    const expenses = [
      expense({ name: 'Solo coffee', amountMinor: 15000, paidBy: 'rahul', involved: ['rahul'] }),
    ]
    const sheet = computeBalances(people, expenses)
    expect(sheet.get('rahul')!.netMinor).toBe(0)
    expect(isSettled(sheet)).toBe(true)
  })

  it('handles refunds as negative expenses', () => {
    const expenses = [
      expense({ name: 'Hotel', amountMinor: 300000, paidBy: 'rahul', involved: ['rahul', 'anu', 'vikram'] }),
      expense({ name: 'Hotel refund', amountMinor: -60000, paidBy: 'rahul', involved: ['rahul', 'anu', 'vikram'] }),
    ]
    const sheet = computeBalances(people, expenses)

    expect(sheet.get('rahul')!.paidMinor).toBe(240000)
    expect(sheet.get('anu')!.shareMinor).toBe(80000)
    expect(totalNet(sheet)).toBe(0)
  })

  it('supports multiple payers on one expense', () => {
    const expenses = [
      expense({
        name: 'Group booking',
        amountMinor: 300000,
        paidBy: [
          { personId: 'rahul', amountMinor: 200000 },
          { personId: 'anu', amountMinor: 100000 },
        ],
        involved: ['rahul', 'anu', 'vikram'],
      }),
    ]
    const sheet = computeBalances(people, expenses)

    expect(sheet.get('rahul')!.netMinor).toBe(100000)
    expect(sheet.get('anu')!.netMinor).toBe(0)
    expect(sheet.get('vikram')!.netMinor).toBe(-100000)
    expect(totalNet(sheet)).toBe(0)
  })
})

describe('isSettled', () => {
  it('is true only when every net is zero', () => {
    const expenses = [
      expense({ name: 'Dinner', amountMinor: 90000, paidBy: 'rahul', involved: ['rahul', 'anu', 'vikram'] }),
    ]
    expect(isSettled(computeBalances(people, expenses))).toBe(false)

    const payments = [payment('anu', 'rahul', 30000), payment('vikram', 'rahul', 30000)]
    expect(isSettled(computeBalances(people, expenses, payments))).toBe(true)
  })

  it('is true for an empty plan', () => {
    expect(isSettled(computeBalances(people, []))).toBe(true)
  })
})

describe('totalsByCategory', () => {
  it('totals per category, largest first', () => {
    const expenses = [
      expense({ name: 'Dinner', amountMinor: 240000, paidBy: 'rahul', involved: ['rahul'], categoryId: 'food' }),
      expense({ name: 'Lunch', amountMinor: 60000, paidBy: 'rahul', involved: ['rahul'], categoryId: 'food' }),
      expense({ name: 'Cab', amountMinor: 100000, paidBy: 'anu', involved: ['anu'], categoryId: 'travel' }),
    ]
    expect(totalsByCategory(expenses)).toEqual([
      { categoryId: 'food', totalMinor: 300000, count: 2 },
      { categoryId: 'travel', totalMinor: 100000, count: 1 },
    ])
  })
})
