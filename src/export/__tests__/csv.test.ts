import { describe, expect, it } from 'vitest'
import { buildDemoBundle } from '@/data/seed'
import { balancesCsv, expensesCsv, fullCsv, settlementCsv } from '../csv'
import { buildShareText, buildUpiTargets } from '../share'
import { buildUpiLink } from '@/domain/summary'

const bundle = buildDemoBundle()

describe('CSV export', () => {
  it('writes one row per expense plus a header', () => {
    const lines = expensesCsv(bundle).split('\r\n')
    expect(lines).toHaveLength(bundle.expenses.length + 1)
    expect(lines[0]).toMatch(/^Date,Expense,Category,Amount \(INR\)/)
  })

  it('writes one row per person', () => {
    const lines = balancesCsv(bundle).split('\r\n')
    expect(lines).toHaveLength(bundle.people.length + 1)
  })

  it('quotes fields containing commas', () => {
    const csv = expensesCsv(bundle)
    // The shares column joins names with "; " and the payers column can contain commas.
    expect(csv).toMatch(/"/)
    // Every quoted field must be balanced.
    for (const line of csv.split('\r\n')) {
      expect((line.match(/"/g) ?? []).length % 2).toBe(0)
    }
  })

  it('neutralises values that spreadsheets would treat as formulas', () => {
    const risky = {
      ...bundle,
      expenses: [{ ...bundle.expenses[0], name: '=HYPERLINK("http://evil")' }],
    }
    expect(expensesCsv(risky)).toContain("'=HYPERLINK")
  })

  it('reports settlement status per obligation', () => {
    const csv = settlementCsv(bundle)
    expect(csv).toMatch(/Partially paid|Pending|Paid/)
  })

  it('bundles every section into one file', () => {
    const csv = fullCsv(bundle)
    for (const heading of ['expenses', 'per-person breakdown', 'settlement status', 'recorded payments']) {
      expect(csv).toContain(heading)
    }
  })
})

describe('share text', () => {
  it('leads with the plan name and total', () => {
    const text = buildShareText(bundle)
    expect(text).toContain('Goa Trip')
    expect(text).toMatch(/Total spent/)
  })

  it('lists only what is still outstanding', () => {
    const text = buildShareText(bundle)
    expect(text).toMatch(/Settle with Rahul/)
    // Vikram has paid ₹5,000 of his balance, so his line shows the part payment.
    expect(text).toMatch(/already paid/)
  })

  it('says so plainly when everything is settled', () => {
    const settledBundle = {
      ...bundle,
      expenses: [],
      payments: [],
    }
    expect(buildShareText(settledBundle)).toMatch(/settled up/i)
  })
})

describe('UPI links', () => {
  it('builds a well-formed upi://pay deep link', () => {
    const link = buildUpiLink({
      payeeUpiId: 'rahul@okhdfcbank',
      payeeName: 'Rahul',
      amountMinor: 123450,
      currency: 'INR',
      note: 'Goa Trip settle-up',
    })

    expect(link).toMatch(/^upi:\/\/pay\?/)
    const params = new URLSearchParams(link.split('?')[1])
    expect(params.get('pa')).toBe('rahul@okhdfcbank')
    expect(params.get('pn')).toBe('Rahul')
    expect(params.get('am')).toBe('1234.50')
    expect(params.get('cu')).toBe('INR')
    expect(params.get('tn')).toBe('Goa Trip settle-up')
  })

  it('only offers links for payees who have a UPI ID', () => {
    const targets = buildUpiTargets(bundle)
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      expect(target.toUpiId).toBeTruthy()
      expect(target.amountMinor).toBeGreaterThan(0)
    }
  })

  it('uses the remaining amount, not the original due', () => {
    const vikram = buildUpiTargets(bundle).find((t) => t.fromPersonId === 'per_vikram')
    expect(vikram).toBeDefined()
    // ₹5,000 was already paid, so the link must ask for less than the full due.
    const params = new URLSearchParams(vikram!.link.split('?')[1])
    expect(Number(params.get('am'))).toBe(vikram!.amountMinor / 100)
  })
})
