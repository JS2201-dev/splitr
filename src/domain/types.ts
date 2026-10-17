/**
 * Domain types. Every monetary value in this app is an integer count of
 * *minor units* (paise for INR, cents for USD). There are no floating point
 * amounts anywhere below this line — see `money.ts` for the rationale.
 */

export type PlanType = 'trip' | 'outing' | 'party' | 'other'
export type PlanStatus = 'active' | 'settled' | 'archived'

/** `attendee` takes part in splits; `spender_only` may pay but is never auto-included. */
export type PersonRole = 'attendee' | 'spender_only'

export type SplitType = 'equal' | 'exact' | 'percent' | 'shares'
export type ExpenseSource = 'manual' | 'parsed' | 'seed'
export type PaymentMethod = 'upi' | 'cash' | 'bank' | 'other'
export type SettlementMode = 'collector' | 'minimal'

export interface Plan {
  id: string
  name: string
  type: PlanType
  /** ISO 4217 code. Drives both formatting and minor-unit scale. */
  currency: string
  organizerId: string
  /** ISO date, `YYYY-MM-DD`. */
  startDate: string
  endDate: string
  status: PlanStatus
  settlementMode: SettlementMode
  createdAt: string
  updatedAt: string
}

export interface Person {
  id: string
  planId: string
  name: string
  phone?: string
  upiId?: string
  role: PersonRole
  createdAt: string
}

export interface Category {
  id: string
  planId: string
  name: string
  icon: string
  hidden: boolean
}

export interface Expense {
  id: string
  planId: string
  name: string
  categoryId: string
  /** Signed. Negative represents a refund / reimbursement into the pool. */
  amountMinor: number
  date: string
  notes?: string
  splitType: SplitType
  createdBy: string
  source: ExpenseSource
  createdAt: string
  updatedAt: string
  payers: ExpensePayer[]
  shares: ExpenseShare[]
}

export interface ExpensePayer {
  personId: string
  amountMinor: number
}

export interface ExpenseShare {
  personId: string
  /** Resolved amount this person owes for this expense. Sums to `amountMinor`. */
  shareMinor: number
  /**
   * The raw input that produced `shareMinor`, kept so the expense can be
   * re-opened for editing and re-balanced if the participant set changes.
   * - `exact`   → minor units
   * - `percent` → percentage points (e.g. 33.5)
   * - `shares`  → arbitrary weight (e.g. 2)
   * - `equal`   → undefined
   */
  weightOrPercent?: number
}

export interface Payment {
  id: string
  planId: string
  fromPersonId: string
  toPersonId: string
  amountMinor: number
  method: PaymentMethod
  reference?: string
  date: string
  createdAt: string
  /** Phase 2: links a payment back to the parsed message that proposed it. */
  matchedMessageId?: string
}

export type AuditEntity = 'plan' | 'person' | 'category' | 'expense' | 'payment'
export type AuditAction = 'create' | 'update' | 'delete' | 'restore'

export interface AuditLog {
  id: string
  planId: string
  entity: AuditEntity
  entityId: string
  action: AuditAction
  /** Human-readable one-liner for the activity feed. */
  summary: string
  before?: unknown
  after?: unknown
  /** Person id, or `'system'` for seeded/automated changes. */
  actor: string
  at: string
}

/** Everything belonging to one plan. The unit of load, export and backup. */
export interface PlanBundle {
  plan: Plan
  people: Person[]
  categories: Category[]
  expenses: Expense[]
  payments: Payment[]
  auditLogs: AuditLog[]
}
