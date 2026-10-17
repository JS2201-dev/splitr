import { describe, expect, it } from 'vitest'
import { computeShares, normalisePayers, SplitError } from '../split'
import { sumMinor } from '../money'

const total = (shares: { shareMinor: number }[]) => sumMinor(shares.map((s) => s.shareMinor))

describe('equal split', () => {
  it('divides cleanly when it can', () => {
    const { shares } = computeShares(240000, 'equal', [
      { personId: 'rahul' },
      { personId: 'anu' },
      { personId: 'vikram' },
    ])
    expect(shares.map((s) => s.shareMinor)).toEqual([80000, 80000, 80000])
    expect(total(shares)).toBe(240000)
  })

  it('distributes the leftover paise with 3+ people', () => {
    const { shares } = computeShares(10000, 'equal', [
      { personId: 'rahul' },
      { personId: 'anu' },
      { personId: 'vikram' },
    ])
    expect(total(shares)).toBe(10000)
    expect(shares.map((s) => s.shareMinor).sort()).toEqual([3333, 3333, 3334])
  })

  it('sums exactly for every group size', () => {
    for (let n = 1; n <= 9; n++) {
      const participants = Array.from({ length: n }, (_, i) => ({ personId: `p${i}` }))
      const { shares } = computeShares(100001, 'equal', participants)
      expect(total(shares)).toBe(100001)
    }
  })

  it('handles a single person paying for only themselves', () => {
    const { shares } = computeShares(45000, 'equal', [{ personId: 'rahul' }])
    expect(shares).toEqual([{ personId: 'rahul', shareMinor: 45000 }])
  })
})

describe('exact split', () => {
  it('uses the amounts given', () => {
    const { shares } = computeShares(100000, 'exact', [
      { personId: 'rahul', value: 60000 },
      { personId: 'anu', value: 40000 },
    ])
    expect(shares.map((s) => s.shareMinor)).toEqual([60000, 40000])
    expect(shares[0].weightOrPercent).toBe(60000)
  })

  it('rejects amounts that do not add up', () => {
    expect(() =>
      computeShares(100000, 'exact', [
        { personId: 'rahul', value: 60000 },
        { personId: 'anu', value: 30000 },
      ]),
    ).toThrow(SplitError)
  })

  it('allows a zero share for someone who consumed nothing', () => {
    const { shares } = computeShares(100000, 'exact', [
      { personId: 'rahul', value: 100000 },
      { personId: 'anu', value: 0 },
    ])
    expect(total(shares)).toBe(100000)
  })
})

describe('percent split', () => {
  it('applies clean percentages', () => {
    const { shares } = computeShares(100000, 'percent', [
      { personId: 'rahul', value: 50 },
      { personId: 'anu', value: 30 },
      { personId: 'vikram', value: 20 },
    ])
    expect(shares.map((s) => s.shareMinor)).toEqual([50000, 30000, 20000])
  })

  it('still sums exactly with repeating percentages', () => {
    const { shares } = computeShares(100000, 'percent', [
      { personId: 'rahul', value: 33.33 },
      { personId: 'anu', value: 33.33 },
      { personId: 'vikram', value: 33.34 },
    ])
    expect(total(shares)).toBe(100000)
  })

  it('rejects percentages that do not total 100', () => {
    expect(() =>
      computeShares(100000, 'percent', [
        { personId: 'rahul', value: 50 },
        { personId: 'anu', value: 30 },
      ]),
    ).toThrow(/must add up to 100/)
  })

  it('keeps the entered percentage for later editing', () => {
    const { shares } = computeShares(100000, 'percent', [
      { personId: 'rahul', value: 62.5 },
      { personId: 'anu', value: 37.5 },
    ])
    expect(shares[0].weightOrPercent).toBe(62.5)
  })
})

describe('shares / weights split', () => {
  it('divides by weight', () => {
    const { shares } = computeShares(120000, 'shares', [
      { personId: 'rahul', value: 2 },
      { personId: 'anu', value: 1 },
      { personId: 'vikram', value: 1 },
    ])
    expect(shares.map((s) => s.shareMinor)).toEqual([60000, 30000, 30000])
  })

  it('defaults a missing weight to 1', () => {
    const { shares } = computeShares(30000, 'shares', [
      { personId: 'rahul' },
      { personId: 'anu' },
      { personId: 'vikram' },
    ])
    expect(shares.map((s) => s.shareMinor)).toEqual([10000, 10000, 10000])
  })

  it('sums exactly with awkward weights', () => {
    const { shares } = computeShares(100000, 'shares', [
      { personId: 'a', value: 1 },
      { personId: 'b', value: 1 },
      { personId: 'c', value: 1 },
      { personId: 'd', value: 4 },
    ])
    expect(total(shares)).toBe(100000)
  })

  it('rejects an all-zero weight set', () => {
    expect(() =>
      computeShares(100000, 'shares', [
        { personId: 'rahul', value: 0 },
        { personId: 'anu', value: 0 },
      ]),
    ).toThrow(SplitError)
  })
})

describe('refunds (negative expenses)', () => {
  it('splits a refund so it sums exactly', () => {
    const { shares } = computeShares(-10000, 'equal', [
      { personId: 'rahul' },
      { personId: 'anu' },
      { personId: 'vikram' },
    ])
    expect(total(shares)).toBe(-10000)
    expect(shares.every((s) => s.shareMinor < 0)).toBe(true)
  })
})

describe('split guards', () => {
  it('requires at least one person', () => {
    expect(() => computeShares(1000, 'equal', [])).toThrow(/at least one person/i)
  })

  it('rejects a duplicated person', () => {
    expect(() =>
      computeShares(1000, 'equal', [{ personId: 'rahul' }, { personId: 'rahul' }]),
    ).toThrow(/twice/)
  })
})

describe('normalisePayers', () => {
  it('assigns the whole amount to a single payer', () => {
    expect(normalisePayers(240000, [{ personId: 'rahul' }])).toEqual([
      { personId: 'rahul', amountMinor: 240000 },
    ])
  })

  it('accepts multiple payers that add up', () => {
    const payers = normalisePayers(240000, [
      { personId: 'rahul', amountMinor: 140000 },
      { personId: 'anu', amountMinor: 100000 },
    ])
    expect(sumMinor(payers.map((p) => p.amountMinor))).toBe(240000)
  })

  it('rejects multiple payers that do not add up', () => {
    expect(() =>
      normalisePayers(240000, [
        { personId: 'rahul', amountMinor: 140000 },
        { personId: 'anu', amountMinor: 50000 },
      ]),
    ).toThrow(SplitError)
  })

  it('requires a payer', () => {
    expect(() => normalisePayers(1000, [])).toThrow(/at least one payer/)
  })
})
