import type {
  AuditLog,
  Category,
  Expense,
  Payment,
  Person,
  Plan,
  PlanBundle,
} from '@/domain/types'

/**
 * The persistence seam.
 *
 * Nothing above this interface knows whether data lives in IndexedDB, in
 * memory, or behind a network call. Every method is async even though the
 * IndexedDB implementation could cheat and be synchronous in places — that is
 * the whole point: a Supabase or Firebase adapter can be dropped in later
 * without a single call site changing shape.
 *
 * Writes are per-entity rather than whole-bundle so a future remote adapter can
 * map them onto row-level operations (and row-level security) directly.
 */
export interface StorageAdapter {
  readonly name: string

  init(): Promise<void>

  // Plans
  listPlans(): Promise<Plan[]>
  getPlan(planId: string): Promise<Plan | undefined>
  putPlan(plan: Plan): Promise<void>
  deletePlan(planId: string): Promise<void>

  /** Load a plan and everything belonging to it in one round trip. */
  loadBundle(planId: string): Promise<PlanBundle | undefined>

  // People
  putPerson(person: Person): Promise<void>
  deletePerson(planId: string, personId: string): Promise<void>

  // Categories
  putCategory(category: Category): Promise<void>
  deleteCategory(planId: string, categoryId: string): Promise<void>

  // Expenses
  putExpense(expense: Expense): Promise<void>
  deleteExpense(planId: string, expenseId: string): Promise<void>

  // Payments
  putPayment(payment: Payment): Promise<void>
  deletePayment(planId: string, paymentId: string): Promise<void>

  // Audit
  appendAudit(entry: AuditLog): Promise<void>

  /** Bulk import — used by seeding, restore, and Splitwise CSV import. */
  importBundle(bundle: PlanBundle): Promise<void>

  /** Wipe everything. Used by the "reset demo data" affordance. */
  clearAll(): Promise<void>
}
