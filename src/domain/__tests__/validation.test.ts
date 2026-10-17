import { describe, expect, it } from 'vitest'
import { canRemovePerson, hasBlockingIssues, validateExpense, validatePayment } from '../validation'
import type { ExpenseDraft } from '../validation'
import { expense, payment, person } from './factories'

const rahul = person('Rahul')
const anu = person('Anu')
const vikram = person('Vikram')
const people = [rahul, anu, vikram]

const draft = (overrides: Partial<ExpenseDraft> = {}): ExpenseDraft => ({
  name: 'Dinner',
  categoryId: 'food',
  amountMinor: 90000,
  date: '2026-01-10',
  payers: [{ personId: 'rahul', amountMinor: 90000 }],
  shares: [
    { personId: 'rahul', shareMinor: 30000 },
    { personId: 'anu', shareMinor: 30000 },
    { personId: 'vikram', shareMinor: 30000 },
  ],
  ...overrides,
})

describe('validateExpense', () => {
  it('accepts a well-formed expense', () => {
    expect(validateExpense(draft(), people, [])).toEqual([])
  })

  it('requires a positive non-zero amount', () => {
    expect(validateExpense(draft({ amountMinor: 0, shares: [], payers: [] }), people, [])).toContainEqual(
      expect.objectContaining({ field: 'amount', severity: 'error' }),
    )
    expect(validateExpense(draft({ amountMinor: null, shares: [], payers: [] }), people, [])).toContainEqual(
      expect.objectContaining({ field: 'amount' }),
    )
  })

  it('requires a name, category and valid date', () => {
    const issues = validateExpense(draft({ name: '  ', categoryId: '', date: 'yesterday' }), people, [])
    expect(issues.map((i) => i.field)).toEqual(expect.arrayContaining(['name', 'categoryId', 'date']))
  })

  it('requires a payer who exists', () => {
    const issues = validateExpense(
      draft({ payers: [{ personId: 'ghost', amountMinor: 90000 }] }),
      people,
      [],
    )
    expect(issues).toContainEqual(expect.objectContaining({ field: 'payers' }))
  })

  it('requires at least one person involved', () => {
    const issues = validateExpense(draft({ shares: [] }), people, [])
    expect(issues).toContainEqual(
      expect.objectContaining({ field: 'shares', message: expect.stringMatching(/at least one person/i) }),
    )
  })

  it('rejects shares that do not add up to the amount', () => {
    const issues = validateExpense(
      draft({ shares: [{ personId: 'rahul', shareMinor: 10000 }] }),
      people,
      [],
    )
    expect(issues).toContainEqual(
      expect.objectContaining({ message: expect.stringMatching(/add up to the expense total/) }),
    )
  })

  it('allows a refund (negative amount)', () => {
    const refund = draft({
      amountMinor: -30000,
      payers: [{ personId: 'rahul', amountMinor: -30000 }],
      shares: [
        { personId: 'rahul', shareMinor: -10000 },
        { personId: 'anu', shareMinor: -10000 },
        { personId: 'vikram', shareMinor: -10000 },
      ],
    })
    expect(hasBlockingIssues(validateExpense(refund, people, []))).toBe(false)
  })

  it('warns — but does not block — on a likely duplicate', () => {
    const existing = [
      expense({ name: 'Dinner', amountMinor: 90000, paidBy: 'rahul', involved: ['rahul', 'anu', 'vikram'], date: '2026-01-10' }),
    ]
    const issues = validateExpense(draft(), people, existing)

    expect(issues).toContainEqual(expect.objectContaining({ field: 'duplicate', severity: 'warning' }))
    expect(hasBlockingIssues(issues)).toBe(false)
  })

  it('does not flag an expense as a duplicate of itself when editing', () => {
    const existing = [
      expense({ id: 'exp-same', name: 'Dinner', amountMinor: 90000, paidBy: 'rahul', involved: ['rahul'], date: '2026-01-10' }),
    ]
    const issues = validateExpense(draft({ id: 'exp-same' }), people, existing)
    expect(issues.some((i) => i.field === 'duplicate')).toBe(false)
  })
})

describe('canRemovePerson', () => {
  it('allows removing someone with no activity', () => {
    expect(canRemovePerson('vikram', people, [], [])).toEqual({ canRemove: true })
  })

  it('blocks removing someone who owes money', () => {
    const expenses = [
      expense({ name: 'Dinner', amountMinor: 90000, paidBy: 'rahul', involved: ['rahul', 'anu', 'vikram'] }),
    ]
    const result = canRemovePerson('anu', people, expenses, [])
    expect(result.canRemove).toBe(false)
    expect(result.reason).toMatch(/still owe/)
  })

  it('blocks removing someone who is owed money', () => {
    const expenses = [
      expense({ name: 'Dinner', amountMinor: 90000, paidBy: 'rahul', involved: ['rahul', 'anu', 'vikram'] }),
    ]
    const result = canRemovePerson('rahul', people, expenses, [])
    expect(result.canRemove).toBe(false)
    expect(result.reason).toMatch(/still owed/)
  })

  it('blocks removing someone square but still on expense rows', () => {
    const expenses = [
      expense({ name: 'Solo', amountMinor: 15000, paidBy: 'anu', involved: ['anu'] }),
    ]
    const result = canRemovePerson('anu', people, expenses, [])
    expect(result.canRemove).toBe(false)
    expect(result.reason).toMatch(/appear on 1 expense/)
  })

  it('blocks removing someone with recorded payments', () => {
    const result = canRemovePerson('anu', people, [], [payment('anu', 'rahul', 10000)])
    expect(result.canRemove).toBe(false)
  })
})

describe('validatePayment', () => {
  it('accepts a sensible payment', () => {
    expect(validatePayment(10000, 'anu', 'rahul', people)).toEqual([])
  })

  it('rejects zero and negative amounts', () => {
    expect(validatePayment(0, 'anu', 'rahul', people)).toHaveLength(1)
    expect(validatePayment(-100, 'anu', 'rahul', people)).toHaveLength(1)
  })

  it('rejects a self-payment', () => {
    expect(validatePayment(10000, 'anu', 'anu', people)).toContainEqual(
      expect.objectContaining({ message: expect.stringMatching(/cannot pay themselves/) }),
    )
  })

  it('rejects unknown people', () => {
    expect(validatePayment(10000, 'ghost', 'rahul', people)).toContainEqual(
      expect.objectContaining({ field: 'from' }),
    )
  })
})
