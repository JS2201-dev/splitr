import { useMemo, useState } from 'react'
import { formatMinor } from '@/domain/money'
import type { PlanBundle } from '@/domain/types'
import { parseQuickAdd, type QuickAddResult } from '@/lib/quickAdd'
import { Sheet, cx } from './ui'
import type { ExpenseSheetPrefill } from './ExpenseSheet'

const PLACEHOLDER = `Dinner | 2400 | Rahul | Rahul, Anu, Vikram
Cab to hotel | 650 | Anu | all
Movie | 1200 | Vikram | all except Anu`

/**
 * The fast path for entering a batch of expenses (§2.3).
 *
 * Parsed rows are never saved directly — each one opens the full form
 * pre-filled so the user confirms the payer and split before it hits the
 * balance sheet. A misread payer would corrupt every subsequent number, so
 * the confirmation step is not optional.
 */
export function QuickAddSheet({
  open,
  onClose,
  bundle,
  onConfirmRow,
}: {
  open: boolean
  onClose: () => void
  bundle: PlanBundle
  onConfirmRow: (prefill: ExpenseSheetPrefill) => void
}) {
  const [text, setText] = useState('')

  const results = useMemo(
    () =>
      text.trim()
        ? parseQuickAdd(text, bundle.people, bundle.categories, bundle.plan.currency)
        : [],
    [text, bundle],
  )

  const usable = results.filter((r) => r.errors.length === 0)

  function confirm(result: QuickAddResult) {
    onConfirmRow({
      name: result.name,
      amountMinor: result.amountMinor,
      categoryId: result.categoryId,
      payerId: result.payerId,
      involvedIds: result.involvedIds,
    })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="tall"
      title="Quick add"
      subtitle="One expense per line"
      footer={
        <button
          className="btn-primary w-full"
          disabled={usable.length === 0}
          onClick={() => {
            // Open the form for the first usable row; the rest stay listed so
            // the user can work through them one confirmation at a time.
            if (usable[0]) confirm(usable[0])
          }}
        >
          {usable.length === 0
            ? 'Nothing to add yet'
            : `Review first of ${usable.length}`}
        </button>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="quick-add-text">
            Paste or type
          </label>
          <textarea
            id="quick-add-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            className="input resize-none font-mono !text-sm leading-relaxed"
          />
          <p className="mt-2 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
            Format:{' '}
            <code className="rounded bg-ink-100 px-1 py-0.5 dark:bg-ink-800">
              Name | Amount | Paid by | People
            </code>
            <br />
            The last two are optional — leave them off and everyone splits it. You can
            also write <code className="rounded bg-ink-100 px-1 dark:bg-ink-800">all except Anu</code>.
          </p>
        </div>

        {results.length > 0 && (
          <div className="space-y-2">
            <p className="label !mb-0">Parsed {results.length} line{results.length === 1 ? '' : 's'}</p>
            {results.map((result, index) => (
              <ResultRow
                key={index}
                result={result}
                bundle={bundle}
                onConfirm={() => confirm(result)}
              />
            ))}
          </div>
        )}
      </div>
    </Sheet>
  )
}

function ResultRow({
  result,
  bundle,
  onConfirm,
}: {
  result: QuickAddResult
  bundle: PlanBundle
  onConfirm: () => void
}) {
  const ok = result.errors.length === 0
  const nameOf = (id: string) => bundle.people.find((p) => p.id === id)?.name ?? '?'

  return (
    <div
      className={cx(
        'rounded-xl border p-3',
        ok
          ? 'border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900'
          : 'border-rose-300 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{result.name || '(no name)'}</p>
          <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">
            {result.amountMinor !== null
              ? formatMinor(result.amountMinor, bundle.plan.currency)
              : '—'}
            {result.payerId && ` · paid by ${nameOf(result.payerId)}`}
            {result.involvedIds.length > 0 &&
              ` · split ${result.involvedIds.length} way${result.involvedIds.length === 1 ? '' : 's'}`}
          </p>
        </div>

        {ok && (
          <button onClick={onConfirm} className="btn-secondary shrink-0 !px-3 !py-1.5 !text-sm">
            Review
          </button>
        )}
      </div>

      {result.errors.map((error, i) => (
        <p key={i} className="mt-1.5 text-sm font-medium text-rose-700 dark:text-rose-300">
          {error}
        </p>
      ))}
      {ok &&
        result.warnings.map((warning, i) => (
          <p key={i} className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            {warning}
          </p>
        ))}
    </div>
  )
}
