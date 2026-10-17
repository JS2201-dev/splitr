import { describe, expect, it } from 'vitest'
import {
  allocate,
  currencyExponent,
  formatMinor,
  minorToDecimalString,
  parseAmountToMinor,
  sumMinor,
} from '../money'

describe('parseAmountToMinor', () => {
  it('parses plain and decorated decimal input', () => {
    expect(parseAmountToMinor('2400', 'INR')).toBe(240000)
    expect(parseAmountToMinor('2400.50', 'INR')).toBe(240050)
    expect(parseAmountToMinor('₹1,234.50', 'INR')).toBe(123450)
    expect(parseAmountToMinor('  99.9 ', 'INR')).toBe(9990)
    expect(parseAmountToMinor('.5', 'INR')).toBe(50)
  })

  it('handles negative amounts for refunds', () => {
    expect(parseAmountToMinor('-200', 'INR')).toBe(-20000)
    expect(parseAmountToMinor('-0.01', 'INR')).toBe(-1)
  })

  it('rejects malformed input without guessing', () => {
    expect(parseAmountToMinor('', 'INR')).toBeNull()
    expect(parseAmountToMinor('abc', 'INR')).toBeNull()
    expect(parseAmountToMinor('12.3.4', 'INR')).toBeNull()
    expect(parseAmountToMinor('-', 'INR')).toBeNull()
  })

  it('respects currency exponents', () => {
    expect(currencyExponent('JPY')).toBe(0)
    expect(parseAmountToMinor('2400', 'JPY')).toBe(2400)
    expect(parseAmountToMinor('2.500', 'KWD')).toBe(2500)
  })

  it('rounds input with more precision than the currency supports', () => {
    expect(parseAmountToMinor('10.567', 'INR')).toBe(1057)
  })

  it('never introduces float drift', () => {
    // The canonical trap: 0.1 + 0.2 !== 0.3 in floating point.
    const a = parseAmountToMinor('0.1', 'INR')!
    const b = parseAmountToMinor('0.2', 'INR')!
    expect(a + b).toBe(parseAmountToMinor('0.3', 'INR'))
  })
})

describe('minorToDecimalString', () => {
  it('round-trips through parse', () => {
    for (const value of ['0.00', '1.05', '1234.50', '-99.99']) {
      const minor = parseAmountToMinor(value, 'INR')!
      expect(minorToDecimalString(minor, 'INR')).toBe(value)
    }
  })

  it('pads sub-unit values', () => {
    expect(minorToDecimalString(5, 'INR')).toBe('0.05')
    expect(minorToDecimalString(-5, 'INR')).toBe('-0.05')
  })
})

describe('formatMinor', () => {
  it('formats INR with the Indian digit grouping', () => {
    //   is the non-breaking space Intl inserts after the symbol.
    expect(formatMinor(123450, 'INR').replace(/ /g, ' ')).toBe('₹1,234.50')
  })
})

describe('allocate', () => {
  it('splits evenly when it divides cleanly', () => {
    expect(allocate(30000, [1, 1, 1])).toEqual([10000, 10000, 10000])
  })

  it('distributes leftover minor units so the parts sum exactly', () => {
    // ₹100 across 3 people = 33.33 each with 1 paise left over.
    const parts = allocate(10000, [1, 1, 1])
    expect(sumMinor(parts)).toBe(10000)
    expect(parts).toEqual([3334, 3333, 3333])
  })

  it('sums exactly for every group size and awkward amount', () => {
    for (let people = 1; people <= 11; people++) {
      for (const total of [1, 7, 100, 9999, 10000, 123457]) {
        const parts = allocate(total, new Array(people).fill(1))
        expect(sumMinor(parts)).toBe(total)
        // Nobody is more than one minor unit away from anyone else.
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('is deterministic for the same tie-break keys', () => {
    const a = allocate(10000, [1, 1, 1], ['anu', 'rahul', 'vikram'])
    const b = allocate(10000, [1, 1, 1], ['anu', 'rahul', 'vikram'])
    expect(a).toEqual(b)
    // The extra paise goes to the lexicographically first key on a tie.
    expect(a).toEqual([3334, 3333, 3333])
  })

  it('does not depend on input ordering for the same person set', () => {
    const forward = allocate(10000, [1, 1, 1], ['anu', 'rahul', 'vikram'])
    const reversed = allocate(10000, [1, 1, 1], ['vikram', 'rahul', 'anu'])
    // Same person wins the leftover paise regardless of row order.
    expect(forward[0]).toBe(3334)
    expect(reversed[2]).toBe(3334)
  })

  it('honours weights', () => {
    expect(allocate(10000, [2, 1, 1])).toEqual([5000, 2500, 2500])
    const uneven = allocate(10000, [3, 1])
    expect(sumMinor(uneven)).toBe(10000)
    expect(uneven).toEqual([7500, 2500])
  })

  it('allocates negative totals (refunds) exactly', () => {
    const parts = allocate(-10000, [1, 1, 1])
    expect(sumMinor(parts)).toBe(-10000)
    expect(parts).toEqual([-3334, -3333, -3333])
  })

  it('handles zero amounts and zero weights', () => {
    expect(allocate(0, [1, 1])).toEqual([0, 0])
    expect(allocate(0, [0, 0])).toEqual([0, 0])
    expect(() => allocate(100, [0, 0])).toThrow()
  })

  it('rejects nonsensical input', () => {
    expect(() => allocate(100, [])).toThrow()
    expect(() => allocate(100, [-1, 2])).toThrow()
  })
})
