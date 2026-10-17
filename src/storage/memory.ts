import type {
  AuditLog,
  Category,
  Expense,
  Payment,
  Person,
  Plan,
  PlanBundle,
} from '@/domain/types'
import type { StorageAdapter } from './adapter'

/**
 * In-memory adapter.
 *
 * Used by tests, and as the fallback when IndexedDB is unavailable (private
 * browsing in some Safari versions, or a locked-down WebView). Falling back
 * keeps the app usable for the session rather than showing a dead screen —
 * the UI warns that nothing will persist.
 */
export class MemoryAdapter implements StorageAdapter {
  readonly name = 'memory'

  private plans = new Map<string, Plan>()
  private people = new Map<string, Person>()
  private categories = new Map<string, Category>()
  private expenses = new Map<string, Expense>()
  private payments = new Map<string, Payment>()
  private audit = new Map<string, AuditLog>()

  async init(): Promise<void> {}

  async listPlans(): Promise<Plan[]> {
    return [...this.plans.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  }

  async getPlan(planId: string) {
    return this.plans.get(planId)
  }

  async putPlan(plan: Plan) {
    this.plans.set(plan.id, plan)
  }

  async deletePlan(planId: string) {
    this.plans.delete(planId)
    for (const map of [this.people, this.categories, this.expenses, this.payments, this.audit]) {
      for (const [id, value] of map as Map<string, { planId: string }>) {
        if (value.planId === planId) map.delete(id)
      }
    }
  }

  async loadBundle(planId: string): Promise<PlanBundle | undefined> {
    const plan = this.plans.get(planId)
    if (!plan) return undefined
    const byPlan = <T extends { planId: string }>(map: Map<string, T>) =>
      [...map.values()].filter((v) => v.planId === planId)

    return {
      plan,
      people: byPlan(this.people),
      categories: byPlan(this.categories),
      expenses: byPlan(this.expenses),
      payments: byPlan(this.payments),
      auditLogs: byPlan(this.audit),
    }
  }

  async putPerson(person: Person) {
    this.people.set(person.id, person)
  }
  async deletePerson(_planId: string, personId: string) {
    this.people.delete(personId)
  }

  async putCategory(category: Category) {
    this.categories.set(category.id, category)
  }
  async deleteCategory(_planId: string, categoryId: string) {
    this.categories.delete(categoryId)
  }

  async putExpense(expense: Expense) {
    this.expenses.set(expense.id, expense)
  }
  async deleteExpense(_planId: string, expenseId: string) {
    this.expenses.delete(expenseId)
  }

  async putPayment(payment: Payment) {
    this.payments.set(payment.id, payment)
  }
  async deletePayment(_planId: string, paymentId: string) {
    this.payments.delete(paymentId)
  }

  async appendAudit(entry: AuditLog) {
    this.audit.set(entry.id, entry)
  }

  async importBundle(bundle: PlanBundle) {
    this.plans.set(bundle.plan.id, bundle.plan)
    for (const p of bundle.people) this.people.set(p.id, p)
    for (const c of bundle.categories) this.categories.set(c.id, c)
    for (const e of bundle.expenses) this.expenses.set(e.id, e)
    for (const p of bundle.payments) this.payments.set(p.id, p)
    for (const a of bundle.auditLogs) this.audit.set(a.id, a)
  }

  async clearAll() {
    this.plans.clear()
    this.people.clear()
    this.categories.clear()
    this.expenses.clear()
    this.payments.clear()
    this.audit.clear()
  }
}
