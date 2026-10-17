import { useState } from 'react'
import { computeBalances, totalNet } from '@/domain/balances'
import { formatMinor } from '@/domain/money'
import { summariseAll } from '@/domain/summary'
import type { PlanBundle } from '@/domain/types'
import { Avatar, EmptyState, Money, cx } from '@/components/ui'

export function BalancesTab({ bundle, onAdd }: { bundle: PlanBundle; onAdd: () => void }) {
  const { plan, people, expenses, payments } = bundle
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const sheet = computeBalances(people, expenses, payments)
  const summaries = summariseAll(people, expenses, payments, plan.currency)
  const drift = totalNet(sheet)

  if (expenses.length === 0) {
    return (
      <EmptyState
        icon="⚖️"
        title="Nothing to balance yet"
        description="Once there are expenses, this is where you see who's up and who's down."
        action={
          <button onClick={onAdd} className="btn-primary">
            Add an expense
          </button>
        }
      />
    )
  }

  const owing = summaries.filter((s) => s.netMinor < 0)
  const owed = summaries.filter((s) => s.netMinor > 0)
  const square = summaries.filter((s) => s.netMinor === 0)

  return (
    <div className="space-y-5">
      {/* The acceptance invariant, surfaced rather than hidden. If this ever
          fires there is a bug, and showing wrong numbers silently is worse
          than admitting it. */}
      {drift !== 0 && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 dark:border-rose-500/30 dark:bg-rose-500/10">
          <p className="text-sm font-semibold text-rose-900 dark:text-rose-200">
            Balances don't net to zero ({formatMinor(drift, plan.currency)} unaccounted).
          </p>
          <p className="mt-1 text-xs text-rose-800 dark:text-rose-300">
            This is a bug — please report it. The figures below may be wrong.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <SummaryCard
          label="Total spent"
          value={formatMinor(
            expenses.reduce((a, e) => a + e.amountMinor, 0),
            plan.currency,
          )}
        />
        <SummaryCard
          label="Still outstanding"
          value={formatMinor(
            owing.reduce((a, s) => a + Math.abs(s.netMinor), 0),
            plan.currency,
          )}
        />
      </div>

      {[
        { title: 'Owes money', rows: owing },
        { title: 'Gets money back', rows: owed },
        { title: 'All square', rows: square },
      ]
        .filter((group) => group.rows.length > 0)
        .map((group) => (
          <section key={group.title}>
            <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">
              {group.title}
            </h3>
            <div className="space-y-2">
              {group.rows.map((summary) => {
                const row = sheet.get(summary.person.id)!
                const expanded = expandedId === summary.person.id
                const isOrganizer = summary.person.id === plan.organizerId

                return (
                  <div key={summary.person.id} className="card overflow-hidden">
                    <button
                      onClick={() => setExpandedId(expanded ? null : summary.person.id)}
                      className="flex w-full items-center gap-3 p-3 text-left"
                      aria-expanded={expanded}
                    >
                      <Avatar name={summary.person.name} id={summary.person.id} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{summary.person.name}</p>
                        {/* The Organizer tag sits under the name rather than
                            beside it — inline, it stole enough width to
                            truncate "Rahul" to "Ra…" at 375px. */}
                        <p className="text-xs text-ink-500 dark:text-ink-400">
                          {isOrganizer && (
                            <span className="mr-1 font-semibold text-blue-600 dark:text-blue-400">
                              Organizer ·
                            </span>
                          )}
                          paid {formatMinor(row.paidMinor, plan.currency)} · share{' '}
                          {formatMinor(row.shareMinor, plan.currency)}
                        </p>
                      </div>

                      <div className="text-right">
                        <Money
                          minor={summary.netMinor}
                          currency={plan.currency}
                          tone="auto"
                          className="text-lg font-bold"
                        />
                        <p className="text-[10px] uppercase text-ink-400">
                          {summary.netMinor === 0
                            ? 'settled'
                            : summary.netMinor > 0
                              ? 'gets back'
                              : 'owes'}
                        </p>
                      </div>

                      <svg
                        viewBox="0 0 20 20"
                        className={cx(
                          'size-4 shrink-0 text-ink-400 transition-transform',
                          expanded && 'rotate-180',
                        )}
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M5.3 7.3a1 1 0 011.4 0L10 10.6l3.3-3.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 010-1.4z" />
                      </svg>
                    </button>

                    {expanded && (
                      <div className="border-t border-ink-200 bg-ink-50 p-3 dark:border-ink-800 dark:bg-ink-950">
                        <p className="mb-3 text-sm leading-relaxed">{summary.breakdown}</p>

                        {summary.lines.length > 0 && (
                          <div className="space-y-1">
                            {summary.lines.map((line, i) => (
                              <div key={i} className="flex justify-between text-sm">
                                <span className="truncate pr-3 text-ink-600 dark:text-ink-300">
                                  {line.name}
                                </span>
                                <span className="tnum shrink-0 font-medium">
                                  {formatMinor(line.shareMinor, plan.currency)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        {(row.paidOutMinor > 0 || row.receivedMinor > 0) && (
                          <div className="mt-3 space-y-1 border-t border-ink-200 pt-2 text-sm dark:border-ink-800">
                            {row.paidOutMinor > 0 && (
                              <div className="flex justify-between">
                                <span className="text-ink-600 dark:text-ink-300">
                                  Settlement payments made
                                </span>
                                <span className="tnum font-medium">
                                  {formatMinor(row.paidOutMinor, plan.currency)}
                                </span>
                              </div>
                            )}
                            {row.receivedMinor > 0 && (
                              <div className="flex justify-between">
                                <span className="text-ink-600 dark:text-ink-300">
                                  Settlement payments received
                                </span>
                                <span className="tnum font-medium">
                                  {formatMinor(row.receivedMinor, plan.currency)}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
        {label}
      </p>
      <p className="tnum mt-1 text-xl font-bold">{value}</p>
    </div>
  )
}
