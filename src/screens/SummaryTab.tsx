import { useState } from 'react'
import { totalsByCategory } from '@/domain/balances'
import { formatMinor } from '@/domain/money'
import { summariseAll } from '@/domain/summary'
import { buildSettlement } from '@/domain/settlement'
import type { PlanBundle } from '@/domain/types'
import { formatDisplayDate } from '@/lib/id'
import { downloadCsv, fullCsv, safeFilename } from '@/export/csv'
import { buildShareText, shareText, whatsappShareUrl } from '@/export/share'
import { useUiStore } from '@/store/useUiStore'
import { Avatar, EmptyState, Money, cx } from '@/components/ui'

export function SummaryTab({ bundle, onAdd }: { bundle: PlanBundle; onAdd: () => void }) {
  const { plan, people, categories, expenses, payments, auditLogs } = bundle
  const showToast = useUiStore((s) => s.showToast)
  const [showAudit, setShowAudit] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  if (expenses.length === 0) {
    return (
      <EmptyState
        icon="📊"
        title="No summary yet"
        description="Add expenses and you'll get per-category totals, a per-person breakdown, and exports."
        action={
          <button onClick={onAdd} className="btn-primary">
            Add an expense
          </button>
        }
      />
    )
  }

  const total = expenses.reduce((a, e) => a + e.amountMinor, 0)
  const categoryTotals = totalsByCategory(expenses)
  const summaries = summariseAll(people, expenses, payments, plan.currency)
  const view = buildSettlement(people, expenses, payments, plan.settlementMode, plan.organizerId)
  const maxCategory = Math.max(...categoryTotals.map((c) => Math.abs(c.totalMinor)), 1)

  async function handleShare() {
    setBusy('share')
    const text = buildShareText(bundle)
    const result = await shareText(plan.name, text)
    showToast(
      result === 'shared'
        ? 'Shared'
        : result === 'copied'
          ? 'Summary copied to clipboard'
          : 'Could not share — try the WhatsApp button',
    )
    setBusy(null)
  }

  return (
    <div className="space-y-5">
      {/* Header — also the top of the printed page. */}
      <div className="card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold">{plan.name}</h2>
            <p className="text-sm text-ink-500 dark:text-ink-400">
              {formatDisplayDate(plan.startDate)} – {formatDisplayDate(plan.endDate)} ·{' '}
              {people.length} people
            </p>
          </div>
          <span
            className={cx(
              'shrink-0 rounded-full px-2.5 py-1 text-xs font-bold uppercase',
              view.settled
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
            )}
          >
            {view.settled ? 'Settled' : 'Open'}
          </span>
        </div>

        {/* Total gets its own row. In a 3-up grid a six-figure rupee amount
            overflows its column and collides with the next stat. */}
        <div className="mt-4 border-t border-ink-200 pt-4 dark:border-ink-800">
          <Stat label="Total spent" value={formatMinor(total, plan.currency)} large />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Stat label="Expenses" value={String(expenses.length)} />
            <Stat
              label="Per person"
              value={formatMinor(Math.round(total / Math.max(people.length, 1)), plan.currency)}
            />
          </div>
        </div>
      </div>

      {/* Export actions */}
      <div className="no-print grid grid-cols-2 gap-2">
        <button onClick={handleShare} disabled={busy !== null} className="btn-primary !py-3 !text-sm">
          {busy === 'share' ? 'Sharing…' : 'Share summary'}
        </button>
        <a
          href={whatsappShareUrl(buildShareText(bundle))}
          target="_blank"
          rel="noreferrer"
          className="btn-secondary !py-3 !text-sm"
        >
          WhatsApp
        </a>
        <button
          onClick={() => {
            downloadCsv(safeFilename(plan.name, 'csv'), fullCsv(bundle))
            showToast('CSV downloaded')
          }}
          className="btn-secondary !py-3 !text-sm"
        >
          Export CSV
        </button>
        <button
          onClick={async () => {
            setBusy('pdf')
            try {
              // jsPDF is ~400KB — fetched only when someone actually exports.
              const { downloadPlanPdf } = await import('@/export/pdf')
              downloadPlanPdf(bundle)
              showToast('PDF downloaded')
            } catch (error) {
              console.error(error)
              showToast('Could not build the PDF')
            }
            setBusy(null)
          }}
          disabled={busy !== null}
          className="btn-secondary !py-3 !text-sm"
        >
          {busy === 'pdf' ? 'Building…' : 'Export PDF'}
        </button>
        <button onClick={() => window.print()} className="btn-ghost col-span-2 !py-2.5 !text-sm">
          Print / Save as PDF
        </button>
      </div>

      {/* Category breakdown */}
      <section>
        <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">
          By category
        </h3>
        <div className="card divide-y divide-ink-200 overflow-hidden dark:divide-ink-800">
          {categoryTotals.map((row) => {
            const category = categories.find((c) => c.id === row.categoryId)
            const share = (Math.abs(row.totalMinor) / maxCategory) * 100

            return (
              <div key={row.categoryId} className="p-3">
                <div className="flex items-center gap-3">
                  <span className="text-lg" aria-hidden="true">
                    {category?.icon ?? '📦'}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {category?.name ?? 'Uncategorised'}
                  </span>
                  <span className="text-xs text-ink-400">
                    {row.count} item{row.count === 1 ? '' : 's'}
                  </span>
                  <Money
                    minor={row.totalMinor}
                    currency={plan.currency}
                    className="font-bold"
                    signed
                  />
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                  <div
                    className="h-full rounded-full bg-blue-500"
                    style={{ width: `${share}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Per-person spend */}
      <section>
        <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">
          Per person
        </h3>
        <div className="card divide-y divide-ink-200 overflow-hidden dark:divide-ink-800">
          {summaries.map((summary) => (
            <div key={summary.person.id} className="p-3">
              <div className="flex items-center gap-3">
                <Avatar name={summary.person.name} id={summary.person.id} size="sm" />
                <span className="min-w-0 flex-1 truncate font-medium">{summary.person.name}</span>
                <div className="text-right">
                  <Money
                    minor={summary.netMinor}
                    currency={plan.currency}
                    tone="auto"
                    className="font-bold"
                  />
                  <p className="text-[10px] uppercase text-ink-400">{summary.headline}</p>
                </div>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                Paid {formatMinor(summary.paidMinor, plan.currency)} · share{' '}
                {formatMinor(summary.shareMinor, plan.currency)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Audit trail */}
      <section className="no-print">
        <button
          onClick={() => setShowAudit(!showAudit)}
          className="flex w-full items-center justify-between px-1 py-2"
          aria-expanded={showAudit}
        >
          <span className="text-xs font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400">
            Activity ({auditLogs.length})
          </span>
          <svg
            viewBox="0 0 20 20"
            className={cx('size-4 text-ink-400 transition-transform', showAudit && 'rotate-180')}
            fill="currentColor"
          >
            <path d="M5.3 7.3a1 1 0 011.4 0L10 10.6l3.3-3.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 010-1.4z" />
          </svg>
        </button>

        {showAudit && (
          <div className="card divide-y divide-ink-200 overflow-hidden dark:divide-ink-800">
            {[...auditLogs]
              .sort((a, b) => (a.at < b.at ? 1 : -1))
              .slice(0, 50)
              .map((entry) => (
                <div key={entry.id} className="flex items-baseline gap-3 p-3">
                  <span className="min-w-0 flex-1 text-sm">{entry.summary}</span>
                  <span className="shrink-0 text-xs text-ink-400">
                    {new Date(entry.at).toLocaleString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value, large }: { label: string; value: string; large?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide text-ink-400">{label}</p>
      <p className={cx('tnum mt-0.5 truncate font-bold', large && 'text-2xl')}>{value}</p>
    </div>
  )
}
