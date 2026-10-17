import { create } from 'zustand'
import { computeShares, normalisePayers, type SplitParticipantInput } from '@/domain/split'
import type {
  AuditAction,
  AuditEntity,
  AuditLog,
  Category,
  Expense,
  ExpenseSource,
  Payment,
  PaymentMethod,
  Person,
  PersonRole,
  Plan,
  PlanBundle,
  PlanStatus,
  PlanType,
  SettlementMode,
  SplitType,
} from '@/domain/types'
import { computeBalances, isSettled } from '@/domain/balances'
import { allocate, currencyExponent } from '@/domain/money'
import { canRemovePerson } from '@/domain/validation'
import { reidentifyBundle } from '@/export/backup'
import { createDefaultCategories } from '@/data/categories'
import { buildDemoBundle, DEMO_PLAN_ID } from '@/data/seed'
import { getStorage, isStorageDegraded } from '@/storage'
import { newId, nowIso, todayIso } from '@/lib/id'

const SEEDED_KEY = 'splitr.seeded'

export interface ExpenseInput {
  name: string
  categoryId: string
  amountMinor: number
  date: string
  notes?: string
  splitType: SplitType
  participants: SplitParticipantInput[]
  payers: { personId: string; amountMinor?: number }[]
  source?: ExpenseSource
}

export interface PaymentInput {
  fromPersonId: string
  toPersonId: string
  amountMinor: number
  method: PaymentMethod
  reference?: string
  date: string
}

interface DeletedSnapshot {
  kind: 'expense' | 'payment'
  label: string
  restore: () => Promise<void>
}

interface PlanState {
  ready: boolean
  degraded: boolean
  plans: Plan[]
  activePlanId: string | null
  bundle: PlanBundle | null
  /** Populated briefly after a delete so the UI can offer Undo. */
  lastDeleted: DeletedSnapshot | null

  init: () => Promise<void>
  selectPlan: (planId: string) => Promise<void>
  refresh: () => Promise<void>

  createPlan: (input: {
    name: string
    type: PlanType
    currency: string
    startDate: string
    endDate: string
    organizerName: string
    attendeeNames: string[]
  }) => Promise<string>
  updatePlan: (patch: Partial<Omit<Plan, 'id'>>) => Promise<void>
  setSettlementMode: (mode: SettlementMode) => Promise<void>
  setPlanStatus: (status: PlanStatus) => Promise<void>
  deletePlan: (planId: string) => Promise<void>

  addPerson: (input: { name: string; phone?: string; upiId?: string; role: PersonRole }) => Promise<void>
  updatePerson: (personId: string, patch: Partial<Omit<Person, 'id' | 'planId'>>) => Promise<void>
  removePerson: (personId: string) => Promise<{ ok: boolean; reason?: string }>

  addCategory: (name: string, icon: string) => Promise<void>
  updateCategory: (categoryId: string, patch: Partial<Omit<Category, 'id' | 'planId'>>) => Promise<void>

  addExpense: (input: ExpenseInput) => Promise<void>
  updateExpense: (expenseId: string, input: ExpenseInput) => Promise<void>
  deleteExpense: (expenseId: string) => Promise<void>

  recordPayment: (input: PaymentInput) => Promise<void>
  deletePayment: (paymentId: string) => Promise<void>

  undoLastDelete: () => Promise<void>
  clearUndo: () => void

  /** Restore a validated backup, either over the existing plan or as a copy. */
  restoreBundle: (bundle: PlanBundle, mode: 'replace' | 'copy') => Promise<string>
  /** Relabel a plan's currency, rescaling stored minor units if needed. */
  changeCurrency: (currency: string) => Promise<void>

  resetDemoData: () => Promise<void>
}

export const usePlanStore = create<PlanState>((set, get) => {
  /** Append to the audit trail. Never throws into the caller's path. */
  async function audit(
    entity: AuditEntity,
    entityId: string,
    action: AuditAction,
    summary: string,
    before?: unknown,
    after?: unknown,
  ) {
    const { bundle } = get()
    if (!bundle) return

    const entry: AuditLog = {
      id: newId('aud'),
      planId: bundle.plan.id,
      entity,
      entityId,
      action,
      summary,
      before,
      after,
      actor: bundle.plan.organizerId,
      at: nowIso(),
    }

    try {
      const storage = await getStorage()
      await storage.appendAudit(entry)
      set({ bundle: { ...bundle, auditLogs: [...bundle.auditLogs, entry] } })
    } catch (error) {
      console.warn('Failed to write audit entry', error)
    }
  }

  /** Bump the plan's `updatedAt`, and flip settled/active automatically. */
  async function touchPlan(next: PlanBundle): Promise<PlanBundle> {
    const settled = isSettled(computeBalances(next.people, next.expenses, next.payments))
    const hasActivity = next.expenses.length > 0

    let status: PlanStatus = next.plan.status
    if (status !== 'archived') {
      status = settled && hasActivity ? 'settled' : 'active'
    }

    const plan: Plan = { ...next.plan, status, updatedAt: nowIso() }
    const storage = await getStorage()
    await storage.putPlan(plan)

    const updated = { ...next, plan }
    set((state) => ({
      bundle: updated,
      plans: state.plans.map((p) => (p.id === plan.id ? plan : p)),
    }))
    return updated
  }

  function requireBundle(): PlanBundle {
    const { bundle } = get()
    if (!bundle) throw new Error('No plan is open')
    return bundle
  }

  /** Build a fully-resolved expense from form input. */
  function buildExpense(input: ExpenseInput, existing?: Expense): Expense {
    const bundle = requireBundle()
    const { shares } = computeShares(input.amountMinor, input.splitType, input.participants)
    const payers = normalisePayers(input.amountMinor, input.payers)
    const at = nowIso()

    return {
      id: existing?.id ?? newId('exp'),
      planId: bundle.plan.id,
      name: input.name.trim(),
      categoryId: input.categoryId,
      amountMinor: input.amountMinor,
      date: input.date,
      notes: input.notes?.trim() || undefined,
      splitType: input.splitType,
      createdBy: existing?.createdBy ?? bundle.plan.organizerId,
      source: input.source ?? existing?.source ?? 'manual',
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
      payers,
      shares,
    }
  }

  return {
    ready: false,
    degraded: false,
    plans: [],
    activePlanId: null,
    bundle: null,
    lastDeleted: null,

    async init() {
      const storage = await getStorage()
      let plans = await storage.listPlans()

      // First run: drop in the demo trip so there is something to look at.
      // Tracked in localStorage so deleting the demo plan does not resurrect it.
      const alreadySeeded =
        typeof localStorage !== 'undefined' && localStorage.getItem(SEEDED_KEY) === '1'

      if (plans.length === 0 && !alreadySeeded) {
        await storage.importBundle(buildDemoBundle())
        try {
          localStorage.setItem(SEEDED_KEY, '1')
        } catch {
          // Private browsing — the demo just re-seeds next time. Harmless.
        }
        plans = await storage.listPlans()
      }

      set({ plans, ready: true, degraded: isStorageDegraded() })

      const remembered =
        typeof localStorage !== 'undefined' ? localStorage.getItem('splitr.activePlan') : null
      const target = plans.find((p) => p.id === remembered) ?? plans[0]
      if (target) await get().selectPlan(target.id)
    },

    async selectPlan(planId) {
      const storage = await getStorage()
      const bundle = await storage.loadBundle(planId)
      if (!bundle) return

      set({ activePlanId: planId, bundle, lastDeleted: null })
      try {
        localStorage.setItem('splitr.activePlan', planId)
      } catch {
        // Not worth surfacing — it only affects which plan opens next time.
      }
    },

    async refresh() {
      const storage = await getStorage()
      const plans = await storage.listPlans()
      set({ plans })
      const { activePlanId } = get()
      if (activePlanId) await get().selectPlan(activePlanId)
    },

    async createPlan(input) {
      const storage = await getStorage()
      const planId = newId('plan')
      const at = nowIso()

      const organizer: Person = {
        id: newId('per'),
        planId,
        name: input.organizerName.trim() || 'Me',
        role: 'attendee',
        createdAt: at,
      }
      const attendees: Person[] = input.attendeeNames
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ id: newId('per'), planId, name, role: 'attendee' as const, createdAt: at }))

      const plan: Plan = {
        id: planId,
        name: input.name.trim() || 'New plan',
        type: input.type,
        currency: input.currency,
        organizerId: organizer.id,
        startDate: input.startDate,
        endDate: input.endDate,
        status: 'active',
        settlementMode: 'collector',
        createdAt: at,
        updatedAt: at,
      }

      await storage.importBundle({
        plan,
        people: [organizer, ...attendees],
        categories: createDefaultCategories(planId),
        expenses: [],
        payments: [],
        auditLogs: [
          {
            id: newId('aud'),
            planId,
            entity: 'plan',
            entityId: planId,
            action: 'create',
            summary: `Created "${plan.name}"`,
            actor: organizer.id,
            at,
          },
        ],
      })

      set({ plans: await storage.listPlans() })
      await get().selectPlan(planId)
      return planId
    },

    async updatePlan(patch) {
      const bundle = requireBundle()
      const before = bundle.plan
      const plan = { ...before, ...patch, updatedAt: nowIso() }
      const storage = await getStorage()
      await storage.putPlan(plan)

      set((state) => ({
        bundle: { ...bundle, plan },
        plans: state.plans.map((p) => (p.id === plan.id ? plan : p)),
      }))
      await audit('plan', plan.id, 'update', `Updated plan details`, before, plan)
    },

    async setSettlementMode(mode) {
      await get().updatePlan({ settlementMode: mode })
    },

    async setPlanStatus(status) {
      await get().updatePlan({ status })
    },

    async deletePlan(planId) {
      const storage = await getStorage()
      await storage.deletePlan(planId)
      const plans = await storage.listPlans()
      set({ plans })

      if (get().activePlanId === planId) {
        set({ activePlanId: null, bundle: null })
        if (plans[0]) await get().selectPlan(plans[0].id)
      }
    },

    async addPerson(input) {
      const bundle = requireBundle()
      const person: Person = {
        id: newId('per'),
        planId: bundle.plan.id,
        name: input.name.trim(),
        phone: input.phone?.trim() || undefined,
        upiId: input.upiId?.trim() || undefined,
        role: input.role,
        createdAt: nowIso(),
      }

      const storage = await getStorage()
      await storage.putPerson(person)
      await touchPlan({ ...bundle, people: [...bundle.people, person] })
      await audit('person', person.id, 'create', `Added ${person.name}`, undefined, person)
    },

    async updatePerson(personId, patch) {
      const bundle = requireBundle()
      const before = bundle.people.find((p) => p.id === personId)
      if (!before) return

      const person: Person = { ...before, ...patch }
      const storage = await getStorage()
      await storage.putPerson(person)
      await touchPlan({
        ...bundle,
        people: bundle.people.map((p) => (p.id === personId ? person : p)),
      })
      await audit('person', personId, 'update', `Updated ${person.name}`, before, person)
    },

    async removePerson(personId) {
      const bundle = requireBundle()

      if (personId === bundle.plan.organizerId) {
        return { ok: false, reason: 'The organizer cannot be removed — reassign the role first' }
      }

      const check = canRemovePerson(personId, bundle.people, bundle.expenses, bundle.payments)
      if (!check.canRemove) return { ok: false, reason: check.reason }

      const person = bundle.people.find((p) => p.id === personId)
      const storage = await getStorage()
      await storage.deletePerson(bundle.plan.id, personId)
      await touchPlan({ ...bundle, people: bundle.people.filter((p) => p.id !== personId) })
      await audit('person', personId, 'delete', `Removed ${person?.name ?? 'someone'}`, person)

      return { ok: true }
    },

    async addCategory(name, icon) {
      const bundle = requireBundle()
      const category: Category = {
        id: newId('cat'),
        planId: bundle.plan.id,
        name: name.trim(),
        icon,
        hidden: false,
      }
      const storage = await getStorage()
      await storage.putCategory(category)
      await touchPlan({ ...bundle, categories: [...bundle.categories, category] })
      await audit('category', category.id, 'create', `Added category ${category.name}`)
    },

    async updateCategory(categoryId, patch) {
      const bundle = requireBundle()
      const before = bundle.categories.find((c) => c.id === categoryId)
      if (!before) return

      const category = { ...before, ...patch }
      const storage = await getStorage()
      await storage.putCategory(category)
      await touchPlan({
        ...bundle,
        categories: bundle.categories.map((c) => (c.id === categoryId ? category : c)),
      })
      await audit('category', categoryId, 'update', `Updated category ${category.name}`, before, category)
    },

    async addExpense(input) {
      const bundle = requireBundle()
      const expense = buildExpense(input)

      const storage = await getStorage()
      await storage.putExpense(expense)
      await touchPlan({ ...bundle, expenses: [...bundle.expenses, expense] })
      await audit('expense', expense.id, 'create', `Added "${expense.name}"`, undefined, expense)
    },

    async updateExpense(expenseId, input) {
      const bundle = requireBundle()
      const before = bundle.expenses.find((e) => e.id === expenseId)
      if (!before) return

      const expense = buildExpense(input, before)
      const storage = await getStorage()
      await storage.putExpense(expense)
      await touchPlan({
        ...bundle,
        expenses: bundle.expenses.map((e) => (e.id === expenseId ? expense : e)),
      })
      await audit('expense', expenseId, 'update', `Edited "${expense.name}"`, before, expense)
    },

    async deleteExpense(expenseId) {
      const bundle = requireBundle()
      const expense = bundle.expenses.find((e) => e.id === expenseId)
      if (!expense) return

      const storage = await getStorage()
      await storage.deleteExpense(bundle.plan.id, expenseId)
      await touchPlan({ ...bundle, expenses: bundle.expenses.filter((e) => e.id !== expenseId) })
      await audit('expense', expenseId, 'delete', `Deleted "${expense.name}"`, expense)

      set({
        lastDeleted: {
          kind: 'expense',
          label: expense.name,
          restore: async () => {
            const current = requireBundle()
            const store = await getStorage()
            await store.putExpense(expense)
            await touchPlan({ ...current, expenses: [...current.expenses, expense] })
            await audit('expense', expenseId, 'restore', `Restored "${expense.name}"`, undefined, expense)
          },
        },
      })
    },

    async recordPayment(input) {
      const bundle = requireBundle()
      const payment: Payment = {
        id: newId('pay'),
        planId: bundle.plan.id,
        fromPersonId: input.fromPersonId,
        toPersonId: input.toPersonId,
        amountMinor: input.amountMinor,
        method: input.method,
        reference: input.reference?.trim() || undefined,
        date: input.date || todayIso(),
        createdAt: nowIso(),
      }

      const storage = await getStorage()
      await storage.putPayment(payment)
      await touchPlan({ ...bundle, payments: [...bundle.payments, payment] })

      const from = bundle.people.find((p) => p.id === payment.fromPersonId)?.name ?? '?'
      const to = bundle.people.find((p) => p.id === payment.toPersonId)?.name ?? '?'
      await audit('payment', payment.id, 'create', `${from} paid ${to}`, undefined, payment)
    },

    async deletePayment(paymentId) {
      const bundle = requireBundle()
      const payment = bundle.payments.find((p) => p.id === paymentId)
      if (!payment) return

      const storage = await getStorage()
      await storage.deletePayment(bundle.plan.id, paymentId)
      await touchPlan({ ...bundle, payments: bundle.payments.filter((p) => p.id !== paymentId) })
      await audit('payment', paymentId, 'delete', 'Deleted a payment', payment)

      set({
        lastDeleted: {
          kind: 'payment',
          label: 'payment',
          restore: async () => {
            const current = requireBundle()
            const store = await getStorage()
            await store.putPayment(payment)
            await touchPlan({ ...current, payments: [...current.payments, payment] })
            await audit('payment', paymentId, 'restore', 'Restored a payment', undefined, payment)
          },
        },
      })
    },

    async undoLastDelete() {
      const { lastDeleted } = get()
      if (!lastDeleted) return
      await lastDeleted.restore()
      set({ lastDeleted: null })
    },

    clearUndo() {
      set({ lastDeleted: null })
    },

    async restoreBundle(incoming, mode) {
      const storage = await getStorage()

      // `copy` rewrites every id so a restore can never clobber a plan the
      // user still wants; `replace` keeps them so it overwrites in place.
      const bundle =
        mode === 'copy'
          ? reidentifyBundle(incoming, newId)
          : { ...incoming, plan: { ...incoming.plan, updatedAt: nowIso() } }

      if (mode === 'replace') {
        // Drop the existing rows first, otherwise expenses deleted since the
        // backup was taken would survive the restore and double-count.
        await storage.deletePlan(bundle.plan.id)
      }

      await storage.importBundle(bundle)
      set({ plans: await storage.listPlans() })
      await get().selectPlan(bundle.plan.id)

      await audit(
        'plan',
        bundle.plan.id,
        'restore',
        mode === 'copy'
          ? `Restored "${bundle.plan.name}" from a backup as a new plan`
          : `Restored "${bundle.plan.name}" from a backup`,
      )

      return bundle.plan.id
    },

    async changeCurrency(currency) {
      const bundle = requireBundle()
      const from = bundle.plan.currency
      if (from === currency) return

      const fromExponent = currencyExponent(from)
      const toExponent = currencyExponent(currency)

      // Switching INR (2dp) to JPY (0dp) would silently reinterpret 240000
      // paise as ¥240,000. Rescale so the amount the user originally typed
      // still reads the same. This is a relabel, not an FX conversion — real
      // multi-currency with exchange rates is Phase 2.
      if (fromExponent === toExponent) {
        await get().updatePlan({ currency })
        return
      }

      const rescale = (minor: number) =>
        toExponent > fromExponent
          ? minor * 10 ** (toExponent - fromExponent)
          : Math.round(minor / 10 ** (fromExponent - toExponent))

      const storage = await getStorage()

      const expenses = bundle.expenses.map((expense) => {
        const amountMinor = rescale(expense.amountMinor)
        // Re-allocate rather than rescaling each share: rounding down to a
        // coarser currency can break the sum-to-total invariant otherwise.
        const shares = allocate(
          amountMinor,
          expense.shares.map((s) => Math.abs(s.shareMinor) || 1),
          expense.shares.map((s) => s.personId),
        ).map((shareMinor, i) => ({ ...expense.shares[i], shareMinor }))

        const payers = allocate(
          amountMinor,
          expense.payers.map((p) => Math.abs(p.amountMinor) || 1),
          expense.payers.map((p) => p.personId),
        ).map((payerAmount, i) => ({ ...expense.payers[i], amountMinor: payerAmount }))

        return { ...expense, amountMinor, shares, payers, updatedAt: nowIso() }
      })

      const payments = bundle.payments.map((payment) => ({
        ...payment,
        amountMinor: rescale(payment.amountMinor),
      }))

      await Promise.all([
        ...expenses.map((e) => storage.putExpense(e)),
        ...payments.map((p) => storage.putPayment(p)),
      ])

      const plan = { ...bundle.plan, currency, updatedAt: nowIso() }
      await storage.putPlan(plan)
      await touchPlan({ ...bundle, plan, expenses, payments })

      await audit(
        'plan',
        plan.id,
        'update',
        `Changed currency from ${from} to ${currency}`,
        { currency: from },
        { currency },
      )
    },

    async resetDemoData() {
      const storage = await getStorage()
      await storage.importBundle(buildDemoBundle())
      set({ plans: await storage.listPlans() })
      await get().selectPlan(DEMO_PLAN_ID)
    },
  }
})
