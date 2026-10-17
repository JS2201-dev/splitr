import { useMemo, useState } from 'react'
import { formatMinor } from '@/domain/money'
import { buildSettlement, type Obligation } from '@/domain/settlement'
import { buildUpiLink } from '@/domain/summary'
import type { PlanBundle, SettlementMode } from '@/domain/types'
import { formatDisplayDate } from '@/lib/id'
import { usePlanStore } from '@/store/usePlanStore'
import { useUiStore } from '@/store/useUiStore'
import { Avatar, EmptyState, Money, Segmented, StatusPill, cx, useConfirm } from '@/components/ui'

const MODES: { value: SettlementMode; label: string; hint: string }[] = [
  {
    value: 'collector',
    label: 'Via organizer',
    hint: 'Everyone settles with the organizer only — one number each to remember',
  },
  {
    value: 'minimal',
    label: 'Fewest transfers',
    hint: 'Matches debtors to creditors directly to minimise the number of payments',
  },
]

export function SettleTab({
  bundle,
  onRecordPayment,
  onAdd,
}: {
  bundle: PlanBundle
  onRecordPayment: (obligation: Obligation) => void
  onAdd: () => void
}) {
  const { plan, people, expenses, payments } = bundle
  const { setSettlementMode, deletePayment } = usePlanStore()
  const showToast = useUiStore((s) => s.showToast)
  const { confirm, dialog } = useConfirm()
  const [showHistory, setShowHistory] = useState(false)

  const view = useMemo(
    () => buildSettlement(people, expenses, payments, plan.settlementMode, plan.organizerId),
    [people, expenses, payments, plan.settlementMode, plan.organizerId],
  )

  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? '(removed)'

  if (expenses.length === 0) {
    return (
      <EmptyState
        icon="🤝"
        title="Nothing to settle"
        description="Add some expenses and this is where you'll square up."
        action={
          <button onClick={onAdd} className="btn-primary">
            Add an expense
          </button>
        }
      />
    )
  }

  const pending = view.obligations.filter((o) => o.remainingMinor > 0)
  const done = view.obligations.filter((o) => o.remainingMinor === 0)

  return (
    <>
      <div className="space-y-5">
        <div>
          <Segmented
            value={plan.settlementMode}
            onChange={(mode) => setSettlementMode(mode)}
            options={MODES}
            ariaLabel="Settlement mode"
          />
          <p className="mt-2 px-1 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
            {plan.settlementMode === 'collector'
              ? `Everyone settles with ${nameOf(plan.organizerId)}, who pays out to anyone who fronted money. More transfers, but one figure per person.`
              : 'Debtors pay creditors directly, so the money moves in as few transfers as possible.'}
          </p>
        </div>

        {view.settled ? (
          <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6 text-center dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <div className="mb-2 text-4xl" aria-hidden="true">
              🎉
            </div>
            <h3 className="text-lg font-bold text-emerald-900 dark:text-emerald-200">
              Everyone's settled
            </h3>
            <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-300">
              All {formatMinor(view.totalDueMinor, plan.currency)} has been paid. Nothing
              outstanding.
            </p>
          </div>
        ) : (
          <div className="card p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-ink-500 dark:text-ink-400">
                Outstanding
              </span>
              <span className="tnum text-2xl font-bold">
                {formatMinor(view.totalRemainingMinor, plan.currency)}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{
                  width: `${view.totalDueMinor > 0 ? (view.totalPaidMinor / view.totalDueMinor) * 100 : 0}%`,
                }}
              />
            </div>
            <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
              {formatMinor(view.totalPaidMinor, plan.currency)} of{' '}
              {formatMinor(view.totalDueMinor, plan.currency)} settled
            </p>
          </div>
        )}

        {pending.length > 0 && (
          <section>
            <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">
              To pay
            </h3>
            <div className="space-y-2">
              {pending.map((obligation) => (
                <ObligationCard
                  key={obligation.id}
                  obligation={obligation}
                  bundle={bundle}
                  onRecord={() => onRecordPayment(obligation)}
                />
              ))}
            </div>
          </section>
        )}

        {done.length > 0 && (
          <section>
            <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">
              Settled
            </h3>
            <div className="space-y-2">
              {done.map((obligation) => (
                <div key={obligation.id} className="card flex items-center gap-3 p-3 opacity-70">
                  <Avatar name={nameOf(obligation.fromPersonId)} id={obligation.fromPersonId} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {nameOf(obligation.fromPersonId)} → {nameOf(obligation.toPersonId)}
                    </p>
                    {obligation.creditMinor > 0 && (
                      <p className="text-xs text-ink-500">
                        {formatMinor(obligation.creditMinor, plan.currency)} credit
                      </p>
                    )}
                  </div>
                  <Money
                    minor={obligation.paidMinor}
                    currency={plan.currency}
                    className="text-sm font-semibold"
                  />
                  <StatusPill status="paid" />
                </div>
              ))}
            </div>
          </section>
        )}

        {payments.length > 0 && (
          <section>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex w-full items-center justify-between px-1 py-2"
              aria-expanded={showHistory}
            >
              <span className="text-xs font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                Payment history ({payments.length})
              </span>
              <svg
                viewBox="0 0 20 20"
                className={cx('size-4 text-ink-400 transition-transform', showHistory && 'rotate-180')}
                fill="currentColor"
              >
                <path d="M5.3 7.3a1 1 0 011.4 0L10 10.6l3.3-3.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 010-1.4z" />
              </svg>
            </button>

            {showHistory && (
              <div className="card divide-y divide-ink-200 overflow-hidden dark:divide-ink-800">
                {[...payments]
                  .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                  .map((payment) => (
                    <div key={payment.id} className="flex items-center gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {nameOf(payment.fromPersonId)} → {nameOf(payment.toPersonId)}
                        </p>
                        <p className="truncate text-xs text-ink-500 dark:text-ink-400">
                          {formatDisplayDate(payment.date)} · {payment.method.toUpperCase()}
                          {payment.reference && ` · ${payment.reference}`}
                        </p>
                      </div>
                      <Money
                        minor={payment.amountMinor}
                        currency={plan.currency}
                        className="text-sm font-bold"
                      />
                      <button
                        onClick={async () => {
                          if (
                            await confirm('Delete this payment? Balances will go back up.', {
                              confirmLabel: 'Delete',
                              destructive: true,
                            })
                          ) {
                            await deletePayment(payment.id)
                            showToast('Payment deleted', {
                              actionLabel: 'Undo',
                              action: () => usePlanStore.getState().undoLastDelete(),
                            })
                          }
                        }}
                        className="rounded-lg p-2 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"
                        aria-label="Delete payment"
                      >
                        <svg viewBox="0 0 20 20" className="size-4" fill="currentColor">
                          <path d="M8.5 2a1 1 0 00-1 1V4H4.5a.75.75 0 000 1.5h.6l.7 9.1A2.5 2.5 0 008.3 17h3.4a2.5 2.5 0 002.5-2.4l.7-9.1h.6A.75.75 0 0016 4h-3v-.9a1 1 0 00-1-1h-3.5z" />
                        </svg>
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </section>
        )}
      </div>
      {dialog}
    </>
  )
}

function ObligationCard({
  obligation,
  bundle,
  onRecord,
}: {
  obligation: Obligation
  bundle: PlanBundle
  onRecord: () => void
}) {
  const { plan, people } = bundle
  const from = people.find((p) => p.id === obligation.fromPersonId)
  const to = people.find((p) => p.id === obligation.toPersonId)

  const upiLink =
    to?.upiId &&
    buildUpiLink({
      payeeUpiId: to.upiId,
      payeeName: to.name,
      amountMinor: obligation.remainingMinor,
      currency: plan.currency,
      note: `${plan.name} settle-up`,
    })

  return (
    <div className="card p-3">
      {/* Name on its own row, figures below. Squeezing "Rahul pays Anu" and a
          five-digit amount onto one line truncates the names on a 375px
          screen, which is exactly the information you can least afford to
          lose here. */}
      <div className="flex items-start gap-3">
        <Avatar name={from?.name ?? '?'} id={obligation.fromPersonId} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">
            {from?.name} <span className="font-normal text-ink-500">pays</span> {to?.name}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <Money
              minor={obligation.remainingMinor}
              currency={plan.currency}
              className="text-lg font-bold"
            />
            <StatusPill status={obligation.status} />
          </div>
          {obligation.paidMinor > 0 && (
            <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
              {formatMinor(obligation.paidMinor, plan.currency)} of{' '}
              {formatMinor(obligation.amountMinor, plan.currency)} already paid
            </p>
          )}
        </div>
      </div>

      {obligation.status === 'partial' && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
          <div
            className="h-full rounded-full bg-blue-500"
            style={{ width: `${(obligation.paidMinor / obligation.amountMinor) * 100}%` }}
          />
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button onClick={onRecord} className="btn-primary flex-1 !py-2.5 !text-sm">
          Record payment
        </button>
        {upiLink && (
          <a href={upiLink} className="btn-secondary !py-2.5 !text-sm">
            Pay via UPI
          </a>
        )}
      </div>
    </div>
  )
}
