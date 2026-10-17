import { useEffect, useState } from 'react'
import type { Expense } from '@/domain/types'
import type { Obligation } from '@/domain/settlement'
import { usePlanStore } from '@/store/usePlanStore'
import { useUiStore, type TabKey } from '@/store/useUiStore'
import { ExpenseSheet, type ExpenseSheetPrefill } from '@/components/ExpenseSheet'
import { QuickAddSheet } from '@/components/QuickAddSheet'
import { PaymentSheet } from '@/components/PaymentSheet'
import { PeopleSheet } from '@/components/PeopleSheet'
import { CategoriesSheet } from '@/components/CategoriesSheet'
import { PlansSheet } from '@/components/PlansSheet'
import { PlanSettingsSheet } from '@/components/PlanSettingsSheet'
import { ExpensesTab } from '@/screens/ExpensesTab'
import { BalancesTab } from '@/screens/BalancesTab'
import { SettleTab } from '@/screens/SettleTab'
import { SummaryTab } from '@/screens/SummaryTab'
import { EmptyState, cx } from '@/components/ui'
import { useBottomOverlayInset } from '@/lib/useBottomOverlayInset'

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'expenses', label: 'Expenses', icon: '🧾' },
  { key: 'balances', label: 'Balances', icon: '⚖️' },
  { key: 'settle', label: 'Settle up', icon: '🤝' },
  { key: 'summary', label: 'Summary', icon: '📊' },
]

export default function App() {
  const { ready, degraded, bundle, init, addExpense, updateExpense, deleteExpense, recordPayment } =
    usePlanStore()
  const { tab, setTab, theme, setTheme, toast, showToast, dismissToast } = useUiStore()

  const [expenseSheet, setExpenseSheet] = useState<{
    open: boolean
    editing?: Expense
    prefill?: ExpenseSheetPrefill
  }>({ open: false })
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [plansOpen, setPlansOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [payingObligation, setPayingObligation] = useState<Obligation | null>(null)

  useBottomOverlayInset(ready)

  useEffect(() => {
    void init()
  }, [init])

  // Toasts auto-dismiss, but an actionable one (Undo) gets longer to be read.
  useEffect(() => {
    if (!toast) return
    const timeout = setTimeout(dismissToast, toast.action ? 7000 : 3000)
    return () => clearTimeout(timeout)
  }, [toast, dismissToast])

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="animate-pulse text-ink-400">Loading…</div>
      </div>
    )
  }

  if (!bundle) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center">
        <EmptyState
          icon="👋"
          title="Welcome to Splitr"
          description="Create a plan for your trip, outing or party and start tracking who paid for what."
          action={
            <button onClick={() => setPlansOpen(true)} className="btn-primary">
              Create a plan
            </button>
          }
        />
        <PlansSheet open={plansOpen} onClose={() => setPlansOpen(false)} />
      </div>
    )
  }

  const openAddExpense = () => setExpenseSheet({ open: true })

  return (
    <div className="min-h-dvh" style={{ paddingBottom: 'calc(8rem + var(--bottom-overlay))' }}>
      {/* Header */}
      <header className="no-print sticky top-0 z-30 safe-top border-b border-ink-200 bg-ink-50/80 backdrop-blur-lg dark:border-ink-800 dark:bg-ink-950/80">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-2">
          <button
            onClick={() => setPlansOpen(true)}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left active:bg-ink-200 dark:active:bg-ink-800"
          >
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold leading-tight">{bundle.plan.name}</h1>
              <p className="truncate text-xs text-ink-500 dark:text-ink-400">
                {bundle.people.length} people · {bundle.expenses.length} expenses
              </p>
            </div>
            <svg viewBox="0 0 20 20" className="size-4 shrink-0 text-ink-400" fill="currentColor">
              <path d="M5.3 7.3a1 1 0 011.4 0L10 10.6l3.3-3.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 010-1.4z" />
            </svg>
          </button>

          <button
            onClick={() => setPeopleOpen(true)}
            className="rounded-xl p-2.5 text-ink-600 active:bg-ink-200 dark:text-ink-300 dark:active:bg-ink-800"
            aria-label="People"
          >
            <svg viewBox="0 0 20 20" className="size-5" fill="currentColor">
              <path d="M7 8a3 3 0 100-6 3 3 0 000 6zm5.5 1a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM1.6 16.2A5.4 5.4 0 017 12a5.4 5.4 0 015.4 4.2.8.8 0 01-.8.8H2.4a.8.8 0 01-.8-.8zm12 .8a2 2 0 00.2-.8 7 7 0 00-1.2-3.8 4.4 4.4 0 015.4 3.9.7.7 0 01-.7.7h-3.7z" />
            </svg>
          </button>

          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="rounded-xl p-2.5 text-ink-600 active:bg-ink-200 dark:text-ink-300 dark:active:bg-ink-800"
              aria-label="Menu"
              aria-expanded={menuOpen}
            >
              <svg viewBox="0 0 20 20" className="size-5" fill="currentColor">
                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
              </svg>
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xl dark:border-ink-800 dark:bg-ink-900">
                  <MenuItem
                    label="Quick add expenses"
                    onClick={() => {
                      setMenuOpen(false)
                      setQuickAddOpen(true)
                    }}
                  />
                  <MenuItem
                    label="Categories"
                    onClick={() => {
                      setMenuOpen(false)
                      setCategoriesOpen(true)
                    }}
                  />
                  <MenuItem
                    label="Plan settings"
                    onClick={() => {
                      setMenuOpen(false)
                      setSettingsOpen(true)
                    }}
                  />
                  <MenuItem
                    label="Backup & restore"
                    onClick={() => {
                      setMenuOpen(false)
                      setSettingsOpen(true)
                    }}
                  />
                  <MenuItem
                    label={
                      theme === 'dark'
                        ? 'Theme: Dark'
                        : theme === 'light'
                          ? 'Theme: Light'
                          : 'Theme: System'
                    }
                    onClick={() =>
                      setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system')
                    }
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {degraded && (
        <div className="no-print bg-amber-100 px-4 py-2 text-center text-xs font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
          Storage is unavailable — nothing will be saved when you close this tab.
        </div>
      )}

      <main className="mx-auto max-w-2xl px-4 py-4">
        {tab === 'expenses' && (
          <ExpensesTab
            bundle={bundle}
            onAdd={openAddExpense}
            onEdit={(expense) => setExpenseSheet({ open: true, editing: expense })}
          />
        )}
        {tab === 'balances' && <BalancesTab bundle={bundle} onAdd={openAddExpense} />}
        {tab === 'settle' && (
          <SettleTab
            bundle={bundle}
            onAdd={openAddExpense}
            onRecordPayment={setPayingObligation}
          />
        )}
        {tab === 'summary' && <SummaryTab bundle={bundle} onAdd={openAddExpense} />}
      </main>

      {/* Floating add button — bottom-right, above the tab bar, thumb-reachable. */}
      <button
        onClick={openAddExpense}
        style={{ bottom: 'calc(6rem + var(--bottom-overlay))' }}
        className="no-print fixed right-4 z-30 flex size-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/30 transition active:scale-90"
        aria-label="Add expense"
      >
        <svg viewBox="0 0 24 24" className="size-7" fill="currentColor">
          <path d="M12 4a1.2 1.2 0 011.2 1.2v5.6h5.6a1.2 1.2 0 010 2.4h-5.6v5.6a1.2 1.2 0 01-2.4 0v-5.6H5.2a1.2 1.2 0 010-2.4h5.6V5.2A1.2 1.2 0 0112 4z" />
        </svg>
      </button>

      {/* Toast */}
      {toast && (
        <div
          style={{ bottom: 'calc(6rem + var(--bottom-overlay))' }}
          className="no-print fixed left-1/2 z-40 w-[min(92vw,26rem)] -translate-x-1/2 animate-toast-in"
        >
          <div className="flex items-center gap-3 rounded-xl bg-ink-900 px-4 py-3 text-white shadow-xl dark:bg-ink-100 dark:text-ink-900">
            <span className="min-w-0 flex-1 text-sm font-medium">{toast.message}</span>
            {toast.action && (
              <button
                onClick={() => {
                  toast.action?.()
                  dismissToast()
                }}
                className="shrink-0 text-sm font-bold text-blue-400 dark:text-blue-600"
              >
                {toast.actionLabel ?? 'Undo'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bottom tabs */}
      <nav className="no-print nav-bottom fixed left-0 right-0 z-30 border-t border-ink-200 bg-ink-50/95 backdrop-blur-lg dark:border-ink-800 dark:bg-ink-950/95">
        <div className="mx-auto flex max-w-2xl">
          {TABS.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={cx(
                'flex flex-1 flex-col items-center gap-0.5 py-2 transition',
                tab === item.key
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-ink-500 dark:text-ink-400',
              )}
              aria-current={tab === item.key ? 'page' : undefined}
            >
              <span className="text-xl" aria-hidden="true">
                {item.icon}
              </span>
              <span className="text-[11px] font-semibold">{item.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Sheets */}
      <ExpenseSheet
        open={expenseSheet.open}
        onClose={() => setExpenseSheet({ open: false })}
        bundle={bundle}
        editing={expenseSheet.editing}
        prefill={expenseSheet.prefill}
        onSubmit={async (input) => {
          if (expenseSheet.editing) {
            await updateExpense(expenseSheet.editing.id, input)
            showToast('Expense updated')
          } else {
            await addExpense(input)
            showToast('Expense added')
          }
        }}
        onDelete={async (expenseId) => {
          await deleteExpense(expenseId)
          showToast('Expense deleted', {
            actionLabel: 'Undo',
            action: () => usePlanStore.getState().undoLastDelete(),
          })
        }}
      />

      <QuickAddSheet
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        bundle={bundle}
        onConfirmRow={(prefill) => {
          setQuickAddOpen(false)
          setExpenseSheet({ open: true, prefill })
        }}
      />

      <PaymentSheet
        open={payingObligation !== null}
        onClose={() => setPayingObligation(null)}
        bundle={bundle}
        obligation={payingObligation}
        onSubmit={async (input) => {
          await recordPayment(input)
          showToast('Payment recorded')
        }}
      />

      <PeopleSheet open={peopleOpen} onClose={() => setPeopleOpen(false)} bundle={bundle} />
      <CategoriesSheet
        open={categoriesOpen}
        onClose={() => setCategoriesOpen(false)}
        bundle={bundle}
      />
      <PlansSheet open={plansOpen} onClose={() => setPlansOpen(false)} />
      <PlanSettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        bundle={bundle}
      />
    </div>
  )
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full px-4 py-3 text-left text-sm font-medium hover:bg-ink-100 dark:hover:bg-ink-800"
    >
      {label}
    </button>
  )
}
