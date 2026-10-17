import { computeBalances } from './balances'
import { sumMinor } from './money'
import type { Expense, Payment, Person } from './types'

export interface ValidationIssue {
  field: string
  message: string
  /** `error` blocks saving; `warning` is shown but can be dismissed. */
  severity: 'error' | 'warning'
}

export interface ExpenseDraft {
  id?: string
  name: string
  categoryId: string
  amountMinor: number | null
  date: string
  payers: { personId: string; amountMinor: number }[]
  shares: { personId: string; shareMinor: number }[]
}

/**
 * Validate an expense before it is saved.
 *
 * Returns every issue at once rather than failing on the first, so the form can
 * highlight all the problems in a single pass instead of making the user fix
 * them one reload at a time.
 */
export function validateExpense(
  draft: ExpenseDraft,
  people: Person[],
  existingExpenses: Expense[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const peopleById = new Map(people.map((p) => [p.id, p]))

  if (!draft.name.trim()) {
    issues.push({ field: 'name', message: 'Give the expense a name', severity: 'error' })
  }

  if (draft.amountMinor === null) {
    issues.push({ field: 'amount', message: 'Enter an amount', severity: 'error' })
  } else if (draft.amountMinor === 0) {
    issues.push({ field: 'amount', message: 'Amount must not be zero', severity: 'error' })
  }

  if (!draft.categoryId) {
    issues.push({ field: 'categoryId', message: 'Pick a category', severity: 'error' })
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
    issues.push({ field: 'date', message: 'Pick a valid date', severity: 'error' })
  }

  if (draft.payers.length === 0) {
    issues.push({ field: 'payers', message: 'Choose who paid', severity: 'error' })
  }
  for (const payer of draft.payers) {
    if (!peopleById.has(payer.personId)) {
      issues.push({
        field: 'payers',
        message: 'A payer is no longer in this plan',
        severity: 'error',
      })
      break
    }
  }

  if (draft.shares.length === 0) {
    issues.push({
      field: 'shares',
      message: 'At least one person must be involved',
      severity: 'error',
    })
  }
  for (const share of draft.shares) {
    if (!peopleById.has(share.personId)) {
      issues.push({
        field: 'shares',
        message: 'Someone in the split is no longer in this plan',
        severity: 'error',
      })
      break
    }
  }

  if (draft.amountMinor !== null) {
    const payerTotal = sumMinor(draft.payers.map((p) => p.amountMinor))
    if (draft.payers.length > 0 && payerTotal !== draft.amountMinor) {
      issues.push({
        field: 'payers',
        message: 'Payer amounts must add up to the expense total',
        severity: 'error',
      })
    }

    const shareTotal = sumMinor(draft.shares.map((s) => s.shareMinor))
    if (draft.shares.length > 0 && shareTotal !== draft.amountMinor) {
      issues.push({
        field: 'shares',
        message: 'Shares must add up to the expense total',
        severity: 'error',
      })
    }

    const duplicate = findDuplicate(draft, existingExpenses)
    if (duplicate) {
      issues.push({
        field: 'duplicate',
        message: `Looks like a duplicate of "${duplicate.name}" — same amount, payer and date`,
        severity: 'warning',
      })
    }
  }

  return issues
}

export function hasBlockingIssues(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error')
}

/**
 * A likely double-entry: same amount, same date, same primary payer.
 * Deliberately a warning, not an error — two identical ₹200 cab rides on the
 * same day is a perfectly normal thing to happen.
 */
export function findDuplicate(draft: ExpenseDraft, expenses: Expense[]): Expense | undefined {
  if (draft.amountMinor === null || draft.payers.length === 0) return undefined
  const primaryPayer = draft.payers[0].personId

  return expenses.find(
    (e) =>
      e.id !== draft.id &&
      e.amountMinor === draft.amountMinor &&
      e.date === draft.date &&
      e.payers[0]?.personId === primaryPayer,
  )
}

export interface RemovalCheck {
  canRemove: boolean
  reason?: string
}

/**
 * Guard against removing someone mid-trip.
 *
 * Blocking on a non-zero balance is the important one: deleting a person who
 * owes ₹800 would silently destroy ₹800 and break the sum-to-zero invariant.
 * Someone with expenses but a zero balance is still blocked, because their name
 * appears on expense rows that would become unattributable.
 */
export function canRemovePerson(
  personId: string,
  people: Person[],
  expenses: Expense[],
  payments: Payment[],
): RemovalCheck {
  const plan = people.find((p) => p.id === personId)
  if (!plan) return { canRemove: false, reason: 'Person not found' }

  const sheet = computeBalances(people, expenses, payments)
  const balance = sheet.get(personId)

  if (balance && balance.netMinor !== 0) {
    return {
      canRemove: false,
      reason:
        balance.netMinor < 0
          ? 'They still owe money — settle up before removing them'
          : 'They are still owed money — settle up before removing them',
    }
  }

  const involvedIn = expenses.filter(
    (e) =>
      e.payers.some((p) => p.personId === personId) ||
      e.shares.some((s) => s.personId === personId),
  )
  if (involvedIn.length > 0) {
    return {
      canRemove: false,
      reason: `They appear on ${involvedIn.length} expense${involvedIn.length === 1 ? '' : 's'} — remove them from those first`,
    }
  }

  if (payments.some((p) => p.fromPersonId === personId || p.toPersonId === personId)) {
    return { canRemove: false, reason: 'They have recorded payments in this plan' }
  }

  return { canRemove: true }
}

export function validatePayment(
  amountMinor: number | null,
  fromPersonId: string,
  toPersonId: string,
  people: Person[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const ids = new Set(people.map((p) => p.id))

  if (amountMinor === null || amountMinor <= 0) {
    issues.push({ field: 'amount', message: 'Payment amount must be more than zero', severity: 'error' })
  }
  if (!ids.has(fromPersonId)) {
    issues.push({ field: 'from', message: 'Choose who is paying', severity: 'error' })
  }
  if (!ids.has(toPersonId)) {
    issues.push({ field: 'to', message: 'Choose who is being paid', severity: 'error' })
  }
  if (fromPersonId && fromPersonId === toPersonId) {
    issues.push({ field: 'to', message: 'A person cannot pay themselves', severity: 'error' })
  }

  return issues
}
