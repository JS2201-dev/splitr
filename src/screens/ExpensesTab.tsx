import { useMemo, useState } from 'react'
import { formatMinor } from '@/domain/money'
import type { Expense, PlanBundle } from '@/domain/types'
import { formatDisplayDate } from '@/lib/id'
import { Avatar, EmptyState, Money, cx } from '@/components/ui'

/** Group expenses by date so a trip reads as a timeline rather than a list. */
function groupByDate(expenses: Expense[]) {
  const groups = new Map<string, Expense[]>()
  for (const expense of [...expenses].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))) {
    const existing = groups.get(expense.date)
    if (existing) existing.push(expense)
    else groups.set(expense.date, [expense])
  }
  return [...groups.entries()]
}

export function ExpensesTab({
  bundle,
  onEdit,
  onAdd,
}: {
  bundle: PlanBundle
  onEdit: (expense: Expense) => void
  onAdd: () => void
}) {
  const { plan, people, categories, expenses } = bundle
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [personFilter, setPersonFilter] = useState<string | null>(null)

  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? '(removed)'
  const categoryOf = (id: string) => categories.find((c) => c.id === id)

  const filtered = useMemo(
    () =>
      expenses.filter((expense) => {
        if (categoryFilter && expense.categoryId !== categoryFilter) return false
        if (
          personFilter &&
          !expense.payers.some((p) => p.personId === personFilter) &&
          !expense.shares.some((s) => s.personId === personFilter)
        ) {
          return false
        }
        return true
      }),
    [expenses, categoryFilter, personFilter],
  )

  const total = filtered.reduce((a, e) => a + e.amountMinor, 0)
  const grouped = groupByDate(filtered)
  const filtering = categoryFilter !== null || personFilter !== null

  if (expenses.length === 0) {
    return (
      <EmptyState
        icon="🧾"
        title="No expenses yet"
        description="Add the first one and Splitr works out who owes what as you go."
        action={
          <button onClick={onAdd} className="btn-primary">
            Add the first expense
          </button>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="space-y-2">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {categories
            .filter((c) => !c.hidden || expenses.some((e) => e.categoryId === c.id))
            .map((category) => (
              <button
                key={category.id}
                onClick={() =>
                  setCategoryFilter(categoryFilter === category.id ? null : category.id)
                }
                className={cx(
                  'chip shrink-0',
                  categoryFilter === category.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300',
                )}
                aria-pressed={categoryFilter === category.id}
              >
                <span aria-hidden="true">{category.icon}</span>
                {category.name}
              </button>
            ))}
        </div>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {people.map((person) => (
            <button
              key={person.id}
              onClick={() => setPersonFilter(personFilter === person.id ? null : person.id)}
              className={cx(
                'chip shrink-0',
                personFilter === person.id
                  ? 'bg-ink-900 text-white dark:bg-white dark:text-ink-900'
                  : 'bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300',
              )}
              aria-pressed={personFilter === person.id}
            >
              <Avatar name={person.name} id={person.id} size="xs" />
              {person.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between px-1">
        <p className="text-sm text-ink-500 dark:text-ink-400">
          {filtered.length} expense{filtered.length === 1 ? '' : 's'}
          {filtering && (
            <button
              onClick={() => {
                setCategoryFilter(null)
                setPersonFilter(null)
              }}
              className="ml-2 font-semibold text-blue-600 dark:text-blue-400"
            >
              Clear filters
            </button>
          )}
        </p>
        <p className="tnum text-sm font-bold">{formatMinor(total, plan.currency)}</p>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="Nothing matches"
          description="No expenses fit those filters. Try clearing one."
          action={
            <button
              onClick={() => {
                setCategoryFilter(null)
                setPersonFilter(null)
              }}
              className="btn-secondary"
            >
              Clear filters
            </button>
          }
        />
      ) : (
        <div className="space-y-5">
          {grouped.map(([date, dayExpenses]) => (
            <div key={date}>
              <div className="mb-2 flex items-baseline justify-between px-1">
                <h3 className="text-xs font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                  {formatDisplayDate(date)}
                </h3>
                <span className="tnum text-xs text-ink-400">
                  {formatMinor(
                    dayExpenses.reduce((a, e) => a + e.amountMinor, 0),
                    plan.currency,
                  )}
                </span>
              </div>

              <div className="card divide-y divide-ink-200 overflow-hidden dark:divide-ink-800">
                {dayExpenses.map((expense) => {
                  const category = categoryOf(expense.categoryId)
                  const isRefund = expense.amountMinor < 0

                  return (
                    <button
                      key={expense.id}
                      onClick={() => onEdit(expense)}
                      className="flex w-full items-center gap-3 p-3 text-left transition active:bg-ink-100 dark:active:bg-ink-800"
                    >
                      <span
                        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-lg dark:bg-ink-800"
                        aria-hidden="true"
                      >
                        {category?.icon ?? '📦'}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{expense.name}</p>
                        <p className="truncate text-xs text-ink-500 dark:text-ink-400">
                          {expense.payers.map((p) => nameOf(p.personId)).join(' & ')}
                          {' · '}
                          {expense.shares.length === people.length
                            ? 'everyone'
                            : `${expense.shares.length} people`}
                          {expense.splitType !== 'equal' && ` · ${expense.splitType}`}
                        </p>
                      </div>

                      <div className="text-right">
                        <Money
                          minor={expense.amountMinor}
                          currency={plan.currency}
                          className={cx(
                            'font-bold',
                            isRefund && 'text-[var(--color-gets-light)] dark:text-[var(--color-gets-dark)]',
                          )}
                          signed
                        />
                        {isRefund && (
                          <p className="text-[10px] font-semibold uppercase text-ink-400">refund</p>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
