import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
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

interface SplitrDB extends DBSchema {
  plans: { key: string; value: Plan }
  people: { key: string; value: Person; indexes: { byPlan: string } }
  categories: { key: string; value: Category; indexes: { byPlan: string } }
  expenses: { key: string; value: Expense; indexes: { byPlan: string } }
  payments: { key: string; value: Payment; indexes: { byPlan: string } }
  audit: { key: string; value: AuditLog; indexes: { byPlan: string } }
}

const DB_NAME = 'splitr'
const DB_VERSION = 1

type ChildStore = 'people' | 'categories' | 'expenses' | 'payments' | 'audit'
const CHILD_STORES: ChildStore[] = ['people', 'categories', 'expenses', 'payments', 'audit']

/**
 * The Phase 1 storage implementation.
 *
 * Every child store is indexed by `planId`, so loading a plan is a handful of
 * index range reads rather than a full scan. That matters on mobile, where the
 * whole app has to feel instant on a cold start.
 */
export class IndexedDbAdapter implements StorageAdapter {
  readonly name = 'indexeddb'
  private db: IDBPDatabase<SplitrDB> | null = null

  async init(): Promise<void> {
    if (this.db) return
    this.db = await openDB<SplitrDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('plans')) {
          db.createObjectStore('plans', { keyPath: 'id' })
        }
        for (const store of CHILD_STORES) {
          if (!db.objectStoreNames.contains(store)) {
            const objectStore = db.createObjectStore(store, { keyPath: 'id' })
            objectStore.createIndex('byPlan', 'planId')
          }
        }
      },
    })
  }

  private require(): IDBPDatabase<SplitrDB> {
    if (!this.db) throw new Error('IndexedDbAdapter.init() has not been awaited')
    return this.db
  }

  async listPlans(): Promise<Plan[]> {
    const plans = await this.require().getAll('plans')
    return plans.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  }

  async getPlan(planId: string): Promise<Plan | undefined> {
    return this.require().get('plans', planId)
  }

  async putPlan(plan: Plan): Promise<void> {
    await this.require().put('plans', plan)
  }

  async deletePlan(planId: string): Promise<void> {
    const db = this.require()
    const tx = db.transaction(['plans', ...CHILD_STORES], 'readwrite')
    await tx.objectStore('plans').delete(planId)
    await Promise.all(
      CHILD_STORES.map(async (storeName) => {
        const store = tx.objectStore(storeName)
        const keys = await store.index('byPlan').getAllKeys(planId)
        await Promise.all(keys.map((key) => store.delete(key)))
      }),
    )
    await tx.done
  }

  async loadBundle(planId: string): Promise<PlanBundle | undefined> {
    const db = this.require()
    const plan = await db.get('plans', planId)
    if (!plan) return undefined

    const [people, categories, expenses, payments, auditLogs] = await Promise.all([
      db.getAllFromIndex('people', 'byPlan', planId),
      db.getAllFromIndex('categories', 'byPlan', planId),
      db.getAllFromIndex('expenses', 'byPlan', planId),
      db.getAllFromIndex('payments', 'byPlan', planId),
      db.getAllFromIndex('audit', 'byPlan', planId),
    ])

    return { plan, people, categories, expenses, payments, auditLogs }
  }

  async putPerson(person: Person) {
    await this.require().put('people', person)
  }
  async deletePerson(_planId: string, personId: string) {
    await this.require().delete('people', personId)
  }

  async putCategory(category: Category) {
    await this.require().put('categories', category)
  }
  async deleteCategory(_planId: string, categoryId: string) {
    await this.require().delete('categories', categoryId)
  }

  async putExpense(expense: Expense) {
    await this.require().put('expenses', expense)
  }
  async deleteExpense(_planId: string, expenseId: string) {
    await this.require().delete('expenses', expenseId)
  }

  async putPayment(payment: Payment) {
    await this.require().put('payments', payment)
  }
  async deletePayment(_planId: string, paymentId: string) {
    await this.require().delete('payments', paymentId)
  }

  async appendAudit(entry: AuditLog) {
    await this.require().put('audit', entry)
  }

  async importBundle(bundle: PlanBundle): Promise<void> {
    const db = this.require()
    const tx = db.transaction(['plans', ...CHILD_STORES], 'readwrite')

    await tx.objectStore('plans').put(bundle.plan)
    const writes: Promise<unknown>[] = []
    for (const person of bundle.people) writes.push(tx.objectStore('people').put(person))
    for (const category of bundle.categories) writes.push(tx.objectStore('categories').put(category))
    for (const expense of bundle.expenses) writes.push(tx.objectStore('expenses').put(expense))
    for (const payment of bundle.payments) writes.push(tx.objectStore('payments').put(payment))
    for (const entry of bundle.auditLogs) writes.push(tx.objectStore('audit').put(entry))

    await Promise.all(writes)
    await tx.done
  }

  async clearAll(): Promise<void> {
    const db = this.require()
    const tx = db.transaction(['plans', ...CHILD_STORES], 'readwrite')
    await Promise.all([
      tx.objectStore('plans').clear(),
      ...CHILD_STORES.map((store) => tx.objectStore(store).clear()),
    ])
    await tx.done
  }
}
