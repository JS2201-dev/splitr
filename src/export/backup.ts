import type { PlanBundle } from '@/domain/types'
import { computeBalances, totalNet } from '@/domain/balances'
import { sumMinor } from '@/domain/money'
import { safeFilename } from './csv'

/**
 * Backup and restore.
 *
 * CSV and PDF are *reports* — they are lossy and cannot be loaded back. This
 * is the only format that round-trips, and it exists because the app's data
 * lives in IndexedDB on one device: a browser "clear site data", a reinstall,
 * or iOS evicting storage from a PWA that has not been opened in a week all
 * destroy the only record of who owes whom money.
 */

export const BACKUP_FORMAT = 'splitr.backup'
export const BACKUP_VERSION = 1

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  /** Informational only — never trusted on import, always recomputed. */
  checksum: {
    expenseCount: number
    paymentCount: number
    totalExpenseMinor: number
  }
  bundle: PlanBundle
}

export function buildBackup(bundle: PlanBundle): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    checksum: {
      expenseCount: bundle.expenses.length,
      paymentCount: bundle.payments.length,
      totalExpenseMinor: sumMinor(bundle.expenses.map((e) => e.amountMinor)),
    },
    bundle,
  }
}

export function downloadBackup(bundle: PlanBundle): void {
  const blob = new Blob([JSON.stringify(buildBackup(bundle), null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = safeFilename(`${bundle.plan.name}-backup`, 'json')
  link.click()
  URL.revokeObjectURL(url)
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

export interface BackupInspection {
  bundle: PlanBundle
  planName: string
  exportedAt: string
  peopleCount: number
  expenseCount: number
  paymentCount: number
  totalExpenseMinor: number
  currency: string
  /** Non-fatal problems worth showing before the user commits to importing. */
  warnings: string[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new BackupError(`Backup is missing "${field}"`)
  return value
}

/**
 * Parse and validate a backup file.
 *
 * Deliberately strict: an import overwrites a plan, so a malformed file must
 * fail loudly here rather than half-apply and leave the books in a state where
 * balances no longer net to zero. Everything structural is a hard error;
 * anything merely suspicious becomes a warning the user sees before confirming.
 */
export function inspectBackup(text: string): BackupInspection {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new BackupError("That file isn't valid JSON — is it a Splitr backup?")
  }

  if (!isObject(parsed)) throw new BackupError('Backup file is not in the expected format')

  if (parsed.format !== BACKUP_FORMAT) {
    throw new BackupError(
      'That looks like a different kind of file. Splitr backups are the .json files from "Back up this plan".',
    )
  }

  const version = Number(parsed.version)
  if (!Number.isFinite(version) || version > BACKUP_VERSION) {
    throw new BackupError(
      `This backup was made by a newer version of Splitr (v${parsed.version}). Update the app and try again.`,
    )
  }

  if (!isObject(parsed.bundle)) throw new BackupError('Backup has no plan data in it')
  const raw = parsed.bundle

  if (!isObject(raw.plan) || typeof raw.plan.id !== 'string' || typeof raw.plan.name !== 'string') {
    throw new BackupError('Backup is missing its plan details')
  }

  const bundle: PlanBundle = {
    plan: raw.plan as unknown as PlanBundle['plan'],
    people: requireArray(raw.people, 'people') as PlanBundle['people'],
    categories: requireArray(raw.categories, 'categories') as PlanBundle['categories'],
    expenses: requireArray(raw.expenses, 'expenses') as PlanBundle['expenses'],
    payments: requireArray(raw.payments, 'payments') as PlanBundle['payments'],
    auditLogs: Array.isArray(raw.auditLogs) ? (raw.auditLogs as PlanBundle['auditLogs']) : [],
  }

  const warnings: string[] = []

  if (bundle.people.length === 0) warnings.push('This backup has no people in it.')

  // Re-verify the money rather than trusting the file's own checksum. A backup
  // that does not balance would silently poison every figure in the app.
  for (const expense of bundle.expenses) {
    if (!Array.isArray(expense.shares) || !Array.isArray(expense.payers)) {
      throw new BackupError(`Expense "${expense.name ?? '?'}" is malformed`)
    }
    const shareTotal = sumMinor(expense.shares.map((s) => s.shareMinor))
    const payerTotal = sumMinor(expense.payers.map((p) => p.amountMinor))
    if (shareTotal !== expense.amountMinor || payerTotal !== expense.amountMinor) {
      throw new BackupError(
        `Expense "${expense.name}" doesn't add up — this backup is corrupt and importing it would break your balances.`,
      )
    }
  }

  // Defence in depth. Given the per-expense check above this is mathematically
  // unreachable — if every expense's shares and payers sum to its amount, the
  // sheet necessarily nets to zero. Kept as a backstop so a future change to
  // the balance rules can never let a broken backup through silently.
  const drift = totalNet(computeBalances(bundle.people, bundle.expenses, bundle.payments))
  if (drift !== 0) {
    throw new BackupError(
      "This backup's balances don't net to zero, so it's corrupt. Importing it would give you wrong figures.",
    )
  }

  // Orphan references don't break the maths (balances keep the row), but the
  // UI will show "(removed)" so it's worth flagging up front.
  const peopleIds = new Set(bundle.people.map((p) => p.id))
  const orphans = new Set<string>()
  for (const expense of bundle.expenses) {
    for (const share of expense.shares) if (!peopleIds.has(share.personId)) orphans.add(share.personId)
    for (const payer of expense.payers) if (!peopleIds.has(payer.personId)) orphans.add(payer.personId)
  }
  if (orphans.size > 0) {
    warnings.push(
      `${orphans.size} person reference${orphans.size === 1 ? '' : 's'} in the expenses ${orphans.size === 1 ? 'is' : 'are'} missing from the people list — they'll show as "(removed)".`,
    )
  }

  const checksum = isObject(parsed.checksum) ? parsed.checksum : null
  if (checksum && Number(checksum.expenseCount) !== bundle.expenses.length) {
    warnings.push("The file's own expense count doesn't match its contents — it may have been edited by hand.")
  }

  return {
    bundle,
    planName: bundle.plan.name,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : 'unknown',
    peopleCount: bundle.people.length,
    expenseCount: bundle.expenses.length,
    paymentCount: bundle.payments.length,
    totalExpenseMinor: sumMinor(bundle.expenses.map((e) => e.amountMinor)),
    currency: bundle.plan.currency ?? 'INR',
    warnings,
  }
}

/**
 * Give an imported bundle fresh ids.
 *
 * Used when restoring alongside an existing plan rather than over it, so the
 * import cannot clobber a plan the user still wants. Every cross-reference is
 * remapped through the same id table, which is what keeps the shares, payers
 * and payments pointing at the right people after the rewrite.
 */
export function reidentifyBundle(bundle: PlanBundle, makeId: (prefix: string) => string): PlanBundle {
  const planId = makeId('plan')
  const personIds = new Map(bundle.people.map((p) => [p.id, makeId('per')]))
  const categoryIds = new Map(bundle.categories.map((c) => [c.id, makeId('cat')]))

  // An id referenced but not present stays as-is rather than being dropped —
  // balances still account for it, and it renders as "(removed)".
  const person = (id: string) => personIds.get(id) ?? id
  const category = (id: string) => categoryIds.get(id) ?? id

  return {
    plan: {
      ...bundle.plan,
      id: planId,
      organizerId: person(bundle.plan.organizerId),
    },
    people: bundle.people.map((p) => ({ ...p, id: person(p.id), planId })),
    categories: bundle.categories.map((c) => ({ ...c, id: category(c.id), planId })),
    expenses: bundle.expenses.map((e) => ({
      ...e,
      id: makeId('exp'),
      planId,
      categoryId: category(e.categoryId),
      createdBy: person(e.createdBy),
      payers: e.payers.map((p) => ({ ...p, personId: person(p.personId) })),
      shares: e.shares.map((s) => ({ ...s, personId: person(s.personId) })),
    })),
    payments: bundle.payments.map((p) => ({
      ...p,
      id: makeId('pay'),
      planId,
      fromPersonId: person(p.fromPersonId),
      toPersonId: person(p.toPersonId),
    })),
    auditLogs: bundle.auditLogs.map((a) => ({ ...a, id: makeId('aud'), planId })),
  }
}
