import { describe, expect, it } from 'vitest'
import { buildDemoBundle } from '@/data/seed'
import { computeBalances, totalNet } from '@/domain/balances'
import { BackupError, buildBackup, inspectBackup, reidentifyBundle } from '../backup'

const bundle = buildDemoBundle()
const serialise = (value: unknown) => JSON.stringify(value)

describe('backup round-trip', () => {
  it('restores exactly what was exported', () => {
    const result = inspectBackup(serialise(buildBackup(bundle)))

    expect(result.planName).toBe('Goa Trip')
    expect(result.expenseCount).toBe(bundle.expenses.length)
    expect(result.peopleCount).toBe(bundle.people.length)
    expect(result.bundle.expenses).toEqual(bundle.expenses)
    expect(result.bundle.payments).toEqual(bundle.payments)
    expect(result.warnings).toEqual([])
  })

  it('survives a JSON round-trip without losing money', () => {
    const restored = inspectBackup(serialise(buildBackup(bundle))).bundle
    expect(totalNet(computeBalances(restored.people, restored.expenses, restored.payments))).toBe(0)
  })
})

describe('backup validation', () => {
  it('rejects non-JSON', () => {
    expect(() => inspectBackup('not json at all')).toThrow(BackupError)
  })

  it('rejects a file that is not a Splitr backup', () => {
    expect(() => inspectBackup(serialise({ hello: 'world' }))).toThrow(/different kind of file|expected format/)
  })

  it('rejects a backup from a newer app version', () => {
    const future = { ...buildBackup(bundle), version: 99 }
    expect(() => inspectBackup(serialise(future))).toThrow(/newer version/)
  })

  it('rejects a backup whose shares no longer add up', () => {
    const corrupt = structuredClone(buildBackup(bundle))
    corrupt.bundle.expenses[0].shares[0].shareMinor += 100
    expect(() => inspectBackup(serialise(corrupt))).toThrow(/doesn't add up|corrupt/)
  })

  it('accepts payments between any two people — they always net out', () => {
    // A payment moves money between two rows, so it can never unbalance the
    // sheet. This guards against the validator being over-eager and rejecting
    // legitimate backups.
    const extra = structuredClone(buildBackup(bundle))
    extra.bundle.payments.push({
      ...extra.bundle.payments[0],
      id: 'pay_extra',
      fromPersonId: 'per_anu',
      toPersonId: 'per_sam',
      amountMinor: 123_45,
    })
    expect(() => inspectBackup(serialise(extra))).not.toThrow()
  })

  it('catches a tampered payer total, not just a tampered share total', () => {
    const corrupt = structuredClone(buildBackup(bundle))
    corrupt.bundle.expenses[1].payers[0].amountMinor += 500
    expect(() => inspectBackup(serialise(corrupt))).toThrow(/doesn't add up|corrupt/)
  })

  it('rejects a missing people array', () => {
    const corrupt = structuredClone(buildBackup(bundle))
    delete (corrupt.bundle as unknown as Record<string, unknown>).people
    expect(() => inspectBackup(serialise(corrupt))).toThrow(/missing "people"/)
  })

  it('warns about orphaned person references without blocking', () => {
    const orphaned = structuredClone(buildBackup(bundle))
    orphaned.bundle.people = orphaned.bundle.people.filter((p) => p.id !== 'per_sam')

    const result = inspectBackup(serialise(orphaned))
    expect(result.warnings.join()).toMatch(/removed/)
    // Still importable — the maths holds, the name is just unknown.
    expect(result.bundle.expenses.length).toBe(bundle.expenses.length)
  })

  it('warns when the file has been hand-edited', () => {
    const tampered = structuredClone(buildBackup(bundle))
    tampered.checksum.expenseCount = 999
    expect(inspectBackup(serialise(tampered)).warnings.join()).toMatch(/edited by hand/)
  })
})

describe('reidentifyBundle', () => {
  let counter = 0
  const makeId = (prefix: string) => `${prefix}_new_${++counter}`

  it('gives everything fresh ids', () => {
    counter = 0
    const copy = reidentifyBundle(bundle, makeId)

    expect(copy.plan.id).not.toBe(bundle.plan.id)
    expect(copy.people.every((p) => !bundle.people.some((o) => o.id === p.id))).toBe(true)
    expect(copy.expenses.every((e) => e.planId === copy.plan.id)).toBe(true)
  })

  it('remaps every cross-reference consistently', () => {
    counter = 0
    const copy = reidentifyBundle(bundle, makeId)
    const newIds = new Set(copy.people.map((p) => p.id))

    expect(newIds.has(copy.plan.organizerId)).toBe(true)
    for (const expense of copy.expenses) {
      for (const share of expense.shares) expect(newIds.has(share.personId)).toBe(true)
      for (const payer of expense.payers) expect(newIds.has(payer.personId)).toBe(true)
    }
    for (const payment of copy.payments) {
      expect(newIds.has(payment.fromPersonId)).toBe(true)
      expect(newIds.has(payment.toPersonId)).toBe(true)
    }
  })

  it('preserves every balance after remapping', () => {
    counter = 0
    const copy = reidentifyBundle(bundle, makeId)

    const before = computeBalances(bundle.people, bundle.expenses, bundle.payments)
    const after = computeBalances(copy.people, copy.expenses, copy.payments)

    expect(totalNet(after)).toBe(0)
    // Same multiset of balances, just under new ids.
    const nets = (sheet: ReturnType<typeof computeBalances>) =>
      [...sheet.values()].map((r) => r.netMinor).sort((a, b) => a - b)
    expect(nets(after)).toEqual(nets(before))
  })

  it('round-trips through a backup and still balances', () => {
    counter = 0
    const restored = inspectBackup(serialise(buildBackup(bundle))).bundle
    const copy = reidentifyBundle(restored, makeId)
    expect(totalNet(computeBalances(copy.people, copy.expenses, copy.payments))).toBe(0)
  })
})
