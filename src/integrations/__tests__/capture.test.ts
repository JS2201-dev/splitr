import { describe, expect, it } from 'vitest'
import { parseLocalMessage } from '../localParser'
import { buildGpayLink } from '../gpay'
import { matchIncomingPayment } from '../reconcile'
import { buildDemoBundle } from '@/data/seed'
import { buildSettlement } from '@/domain/settlement'
import type { ParseContext } from '../types'

const context: ParseContext = {
  planId: 'goa', currency: 'INR',
  people: [{ id: 'rahul', name: 'Rahul' }, { id: 'anu', name: 'Anu', upiId: 'anu@okaxis' }],
  categories: [{ id: 'food', name: 'Food' }, { id: 'travel', name: 'Travel' }],
}
const parse = (body: string, ctx = context) => parseLocalMessage({ id: 'test', channel: 'manual_paste', receivedAt: '2026-10-21T00:00:00Z', body }, ctx)

describe('message capture', () => {
  it('extracts a debit, category, date and participants without using the available balance', () => {
    const result = parse('INR 2,400.50 debited at Swiggy on 21/10/2026. Avl bal INR 99,000 #goa #food @rahul @anu')
    expect(result.candidate).toMatchObject({ amountMinor: 240050, merchant: 'Swiggy', date: '2026-10-21', direction: 'debit', suggestedCategoryId: 'food', suggestedPersonIds: ['rahul', 'anu'] })
  })
  it('maps Uber to Travel', () => {
    expect(parse('Rs.650 paid to Uber on 2026-10-21').candidate?.suggestedCategoryId).toBe('travel')
  })
  it('does not treat a UPI address as an @mention', () => {
    expect(parse('INR 4000 credited from anu@okaxis on 21-Oct-2026').candidate).toMatchObject({ direction: 'credit', merchant: 'anu@okaxis', suggestedPersonIds: [], date: '2026-10-21' })
  })
  it('leaves conflicting amounts and invalid dates for manual review', () => {
    const result = parse('INR 600 paid to Uber; refund INR 100 on 31/02/2026')
    expect(result.candidate?.amountMinor).toBeNull()
    expect(result.candidate?.date).toBeUndefined()
    expect(result.confidence).toBeLessThan(0.7)
  })
  it('does not use account numbers, references or OTPs as amounts', () => {
    expect(parse('OTP 123456 for account 9999. UPI Ref 123456789012').candidate?.amountMinor).toBeNull()
  })
  it('does not interpret rupees in a USD plan', () => {
    expect(parse('INR 400 paid to Uber', { ...context, currency: 'USD' }).candidate?.amountMinor).toBeNull()
  })
  it('does not guess ambiguous participants', () => {
    const result = parse('INR 400 paid to Uber @anu', { ...context, people: [{ id: 'a', name: 'Anu Shah' }, { id: 'b', name: 'Anu Das' }] })
    expect(result.candidate?.suggestedPersonIds).toEqual([])
    expect(result.notes?.join(' ')).toContain('matches several people')
  })
})

describe('GPay links', () => {
  it('targets the GPay package on Android and preserves encoded payment parameters', () => {
    const link = buildGpayLink('upi://pay?pa=anu%40okaxis&am=4000.00&tn=Goa%3Btrip', 'Android')
    expect(link).toContain('intent://pay?pa=anu%40okaxis&am=4000.00&tn=Goa%3Btrip#Intent;scheme=upi;package=com.google.android.apps.nbu.paisa.user;')
    expect(link).toContain('S.browser_fallback_url=')
  })
  it('uses the documented GPay scheme on iOS', () => expect(buildGpayLink('upi://pay?am=1', 'iPhone')).toBe('gpay://upi/pay?am=1'))
})

describe('repayment reconciliation', () => {
  it('requires credit direction and identity, supports partial payments and rejects excess', () => {
    const bundle = buildDemoBundle()
    const { plan, people, expenses, payments } = bundle
    const o = buildSettlement(people, expenses, payments, plan.settlementMode, plan.organizerId).obligations.find((o) => o.remainingMinor > 0)!
    const candidate = { direction: 'credit' as const, amountMinor: o.remainingMinor, merchant: people.find((p) => p.id === o.fromPersonId)!.name }
    expect(matchIncomingPayment(candidate, bundle)).toContainEqual(o)
    expect(matchIncomingPayment({ ...candidate, amountMinor: Math.max(1, Math.floor(o.remainingMinor / 2)) }, bundle)).toContainEqual(o)
    expect(matchIncomingPayment({ ...candidate, merchant: 'Someone else' }, bundle)).toEqual([])
    expect(matchIncomingPayment({ ...candidate, direction: 'debit' }, bundle)).toEqual([])
    expect(matchIncomingPayment({ ...candidate, amountMinor: o.remainingMinor + 1 }, bundle)).toEqual([])
  })
})
