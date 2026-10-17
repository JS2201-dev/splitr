import { describe, expect, it } from 'vitest'
import { parseQuickAdd, parseQuickAddLine, suggestCategory } from '../quickAdd'
import type { Category, Person } from '@/domain/types'

const people: Person[] = [
  { id: 'p_rahul', planId: 'x', name: 'Rahul', role: 'attendee', createdAt: '' },
  { id: 'p_anu', planId: 'x', name: 'Anu', role: 'attendee', createdAt: '' },
  { id: 'p_vikram', planId: 'x', name: 'Vikram', role: 'attendee', createdAt: '' },
  { id: 'p_priya', planId: 'x', name: 'Priya', role: 'attendee', createdAt: '' },
  { id: 'p_ravi', planId: 'x', name: 'Ravi', role: 'spender_only', createdAt: '' },
]

const categories: Category[] = [
  { id: 'c_food', planId: 'x', name: 'Food', icon: '🍽️', hidden: false },
  { id: 'c_travel', planId: 'x', name: 'Travel', icon: '🚕', hidden: false },
  { id: 'c_stay', planId: 'x', name: 'Stay', icon: '🏨', hidden: false },
]

const parse = (line: string) => parseQuickAddLine(line, people, categories, 'INR')

describe('parseQuickAddLine', () => {
  it('parses the documented format', () => {
    const result = parse('Dinner | 2400 | Rahul | Rahul, Anu, Vikram')

    expect(result.errors).toEqual([])
    expect(result.name).toBe('Dinner')
    expect(result.amountMinor).toBe(240000)
    expect(result.payerId).toBe('p_rahul')
    expect(result.involvedIds).toEqual(['p_rahul', 'p_anu', 'p_vikram'])
  })

  it('suggests a category from the name', () => {
    expect(parse('Dinner | 2400 | Rahul').categoryId).toBe('c_food')
    expect(parse('Uber to airport | 600 | Anu').categoryId).toBe('c_travel')
    expect(parse('Villa booking | 42000 | Rahul').categoryId).toBe('c_stay')
    expect(parse('Something odd | 100 | Rahul').categoryId).toBeUndefined()
  })

  it('defaults to everyone when the split is omitted', () => {
    const result = parse('Dinner | 2400 | Rahul')
    expect(result.involvedIds).toEqual(['p_rahul', 'p_anu', 'p_vikram', 'p_priya'])
    expect(result.warnings).toContain('Split across everyone')
  })

  it('excludes spender-only people from an implicit split', () => {
    expect(parse('Dinner | 2400 | Rahul').involvedIds).not.toContain('p_ravi')
  })

  it('understands "all"', () => {
    expect(parse('Dinner | 2400 | Rahul | all').involvedIds).toHaveLength(4)
    expect(parse('Dinner | 2400 | Rahul | everyone').involvedIds).toHaveLength(4)
  })

  it('understands "all except ..."', () => {
    const result = parse('Scooter | 3600 | Vikram | all except Priya')
    expect(result.errors).toEqual([])
    expect(result.involvedIds).toEqual(['p_rahul', 'p_anu', 'p_vikram'])
  })

  it('understands "except A and B"', () => {
    const result = parse('Scooter | 3600 | Vikram | except Priya and Anu')
    expect(result.involvedIds).toEqual(['p_rahul', 'p_vikram'])
  })

  it('matches names case-insensitively and by prefix', () => {
    expect(parse('Dinner | 100 | rahul').payerId).toBe('p_rahul')
    expect(parse('Dinner | 100 | VIK').payerId).toBe('p_vikram')
  })

  it('accepts decorated amounts', () => {
    expect(parse('Dinner | ₹2,400.50 | Rahul').amountMinor).toBe(240050)
  })

  it('reports an unknown name instead of guessing', () => {
    const result = parse('Dinner | 2400 | Sanjay')
    expect(result.payerId).toBeUndefined()
    expect(result.errors[0]).toMatch(/No one called "Sanjay"/)
  })

  it('reports ambiguity instead of picking one', () => {
    const ambiguous: Person[] = [
      { id: 'p_r1', planId: 'x', name: 'Ravi Kumar', role: 'attendee', createdAt: '' },
      { id: 'p_r2', planId: 'x', name: 'Ravi Shankar', role: 'attendee', createdAt: '' },
    ]
    const result = parseQuickAddLine('Dinner | 100 | Ravi', ambiguous, categories, 'INR')
    expect(result.payerId).toBeUndefined()
    expect(result.errors[0]).toMatch(/ambiguous/)
  })

  it('flags a missing or invalid amount', () => {
    expect(parse('Dinner').errors).toContain('Missing amount')
    expect(parse('Dinner | abc | Rahul').errors[0]).toMatch(/not a valid amount/)
    expect(parse('Dinner | 0 | Rahul').errors).toContain('Amount must not be zero')
  })

  it('flags a missing name', () => {
    expect(parse(' | 2400 | Rahul').errors).toContain('Missing expense name')
  })

  it('warns rather than failing when the payer is omitted', () => {
    const result = parse('Dinner | 2400')
    expect(result.errors).toEqual([])
    expect(result.warnings.join()).toMatch(/No payer/)
  })

  it('rejects an exclusion that empties the split', () => {
    const result = parse('Dinner | 100 | Rahul | all except Rahul, Anu, Vikram, Priya')
    expect(result.errors.join()).toMatch(/excludes everyone/)
  })

  it('de-duplicates a repeated name in the split', () => {
    expect(parse('Dinner | 100 | Rahul | Rahul, Rahul, Anu').involvedIds).toEqual([
      'p_rahul',
      'p_anu',
    ])
  })

  it('allows a negative amount for a refund', () => {
    const result = parse('Deposit refund | -5000 | Rahul')
    expect(result.errors).toEqual([])
    expect(result.amountMinor).toBe(-500000)
  })
})

describe('parseQuickAdd (multi-line)', () => {
  it('parses one expense per line and skips blanks', () => {
    const results = parseQuickAdd(
      `Dinner | 2400 | Rahul | Rahul, Anu, Vikram

       Cab | 600 | Anu | all
       Movie | 1200 | Vikram | all except Anu`,
      people,
      categories,
      'INR',
    )

    expect(results).toHaveLength(3)
    expect(results.every((r) => r.errors.length === 0)).toBe(true)
    expect(results[2].involvedIds).not.toContain('p_anu')
  })

  it('reports per-line errors without dropping the good lines', () => {
    const results = parseQuickAdd('Dinner | 2400 | Rahul\nCab | oops | Anu', people, categories, 'INR')
    expect(results[0].errors).toEqual([])
    expect(results[1].errors).toHaveLength(1)
  })
})

describe('suggestCategory', () => {
  it('ignores hidden categories', () => {
    const hidden: Category[] = [{ ...categories[0], hidden: true }]
    expect(suggestCategory('Dinner', hidden)).toBeUndefined()
  })
})
