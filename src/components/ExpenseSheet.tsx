import { useEffect, useMemo, useState } from 'react'
import {
  currencySymbol,
  formatMinor,
  minorToDecimalString,
  parseAmountToMinor,
  sumMinor,
} from '@/domain/money'
import { computeShares, SplitError } from '@/domain/split'
import { hasBlockingIssues, validateExpense } from '@/domain/validation'
import type { Expense, PlanBundle, SplitType } from '@/domain/types'
import { suggestCategory } from '@/lib/quickAdd'
import { todayIso } from '@/lib/id'
import type { ExpenseInput } from '@/store/usePlanStore'
import { Avatar, Money, Segmented, Sheet, cx } from './ui'

const SPLIT_OPTIONS: { value: SplitType; label: string; hint: string }[] = [
  { value: 'equal', label: 'Equal', hint: 'Split evenly across everyone involved' },
  { value: 'exact', label: 'Exact', hint: 'Enter the precise amount each person owes' },
  { value: 'percent', label: '%', hint: 'Split by percentage — must total 100' },
  { value: 'shares', label: 'Shares', hint: 'Weighted split, e.g. 2 shares vs 1' },
]

export interface ExpenseSheetPrefill {
  name?: string
  amountMinor?: number | null
  categoryId?: string
  payerId?: string
  involvedIds?: string[]
  notes?: string
  date?: string
}

export function ExpenseSheet({
  open,
  onClose,
  bundle,
  editing,
  prefill,
  onSubmit,
  onDelete,
}: {
  open: boolean
  onClose: () => void
  bundle: PlanBundle
  editing?: Expense
  prefill?: ExpenseSheetPrefill
  onSubmit: (input: ExpenseInput) => Promise<void>
  onDelete?: (expenseId: string) => Promise<void>
}) {
  const { plan, people, categories, expenses } = bundle
  const visibleCategories = categories.filter((c) => !c.hidden || c.id === editing?.categoryId)
  const splittable = people.filter((p) => p.role === 'attendee')
  const symbol = currencySymbol(plan.currency)

  const [name, setName] = useState('')
  const [amountText, setAmountText] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [date, setDate] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [splitType, setSplitType] = useState<SplitType>('equal')
  const [involvedIds, setInvolvedIds] = useState<string[]>([])
  const [splitValues, setSplitValues] = useState<Record<string, string>>({})
  const [payerIds, setPayerIds] = useState<string[]>([])
  const [payerAmounts, setPayerAmounts] = useState<Record<string, string>>({})
  const [showNotes, setShowNotes] = useState(false)
  const [dismissedDuplicate, setDismissedDuplicate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitAttempted, setSubmitAttempted] = useState(false)

  // Reset the form each time the sheet opens, from either an edit target,
  // a quick-add prefill, or sensible defaults.
  useEffect(() => {
    if (!open) return

    setSubmitAttempted(false)
    setDismissedDuplicate(false)
    setSaving(false)

    if (editing) {
      setName(editing.name)
      setAmountText(minorToDecimalString(editing.amountMinor, plan.currency))
      setCategoryId(editing.categoryId)
      setDate(editing.date)
      setNotes(editing.notes ?? '')
      setShowNotes(Boolean(editing.notes))
      setSplitType(editing.splitType)
      setInvolvedIds(editing.shares.map((s) => s.personId))
      setSplitValues(
        Object.fromEntries(
          editing.shares.map((s) => [
            s.personId,
            editing.splitType === 'exact'
              ? minorToDecimalString(s.shareMinor, plan.currency)
              : String(s.weightOrPercent ?? ''),
          ]),
        ),
      )
      setPayerIds(editing.payers.map((p) => p.personId))
      setPayerAmounts(
        Object.fromEntries(
          editing.payers.map((p) => [p.personId, minorToDecimalString(p.amountMinor, plan.currency)]),
        ),
      )
      return
    }

    setName(prefill?.name ?? '')
    setAmountText(
      prefill?.amountMinor != null ? minorToDecimalString(prefill.amountMinor, plan.currency) : '',
    )
    setCategoryId(prefill?.categoryId ?? '')
    setDate(prefill?.date ?? todayIso())
    setNotes(prefill?.notes ?? '')
    setShowNotes(Boolean(prefill?.notes))
    setSplitType('equal')
    setInvolvedIds(prefill?.involvedIds ?? splittable.map((p) => p.id))
    setSplitValues({})
    setPayerIds(prefill?.payerId ? [prefill.payerId] : [plan.organizerId])
    setPayerAmounts({})
    // Only re-seed when the sheet transitions to open or the target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id, prefill])

  const amountMinor = amountText.trim() ? parseAmountToMinor(amountText, plan.currency) : null

  // Suggest a category from the name, but never override an explicit choice.
  useEffect(() => {
    if (categoryId || !name.trim()) return
    const suggested = suggestCategory(name, visibleCategories)
    if (suggested) setCategoryId(suggested)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name])

  const participants = useMemo(
    () =>
      involvedIds.map((personId) => {
        if (splitType === 'equal') return { personId }
        const raw = splitValues[personId]
        if (splitType === 'exact') {
          return { personId, value: parseAmountToMinor(raw ?? '', plan.currency) ?? 0 }
        }
        const parsed = Number(raw)
        return { personId, value: Number.isFinite(parsed) ? parsed : splitType === 'shares' ? 1 : 0 }
      }),
    [involvedIds, splitType, splitValues, plan.currency],
  )

  // Live preview of the resolved shares. Errors here are expected while the
  // user is mid-edit (percentages not yet summing to 100), so they surface as
  // inline guidance rather than exceptions.
  const preview = useMemo(() => {
    if (amountMinor === null || involvedIds.length === 0) {
      return { shares: [] as { personId: string; shareMinor: number }[], error: null as string | null }
    }
    try {
      return { shares: computeShares(amountMinor, splitType, participants).shares, error: null }
    } catch (error) {
      return {
        shares: [],
        error: error instanceof SplitError ? error.message : 'Could not work out this split',
      }
    }
  }, [amountMinor, splitType, participants, involvedIds.length])

  const payers = useMemo(() => {
    if (payerIds.length === 1) {
      return [{ personId: payerIds[0], amountMinor: amountMinor ?? 0 }]
    }
    return payerIds.map((personId) => ({
      personId,
      amountMinor: parseAmountToMinor(payerAmounts[personId] ?? '', plan.currency) ?? 0,
    }))
  }, [payerIds, payerAmounts, amountMinor, plan.currency])

  const issues = useMemo(
    () =>
      validateExpense(
        {
          id: editing?.id,
          name,
          categoryId,
          amountMinor,
          date,
          payers,
          shares: preview.shares,
        },
        people,
        expenses,
      ),
    [editing?.id, name, categoryId, amountMinor, date, payers, preview.shares, people, expenses],
  )

  const duplicateWarning = issues.find((i) => i.field === 'duplicate')
  const blocking = hasBlockingIssues(issues) || preview.error !== null
  const canSave = !blocking && !saving && (!duplicateWarning || dismissedDuplicate)

  const errorFor = (field: string) =>
    submitAttempted ? issues.find((i) => i.field === field && i.severity === 'error')?.message : undefined

  const toggleInvolved = (personId: string) => {
    setInvolvedIds((current) =>
      current.includes(personId) ? current.filter((id) => id !== personId) : [...current, personId],
    )
  }

  const togglePayer = (personId: string) => {
    setPayerIds((current) => {
      if (current.includes(personId)) {
        // Never leave the expense with no payer.
        return current.length === 1 ? current : current.filter((id) => id !== personId)
      }
      return [...current, personId]
    })
  }

  const payerTotal = sumMinor(payers.map((p) => p.amountMinor))

  async function handleSubmit() {
    setSubmitAttempted(true)
    if (!canSave || amountMinor === null) return

    setSaving(true)
    try {
      await onSubmit({
        name,
        categoryId,
        amountMinor,
        date,
        notes,
        splitType,
        participants,
        payers,
      })
      onClose()
    } catch (error) {
      console.error('Failed to save expense', error)
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="tall"
      title={editing ? 'Edit expense' : 'Add expense'}
      subtitle={plan.name}
      footer={
        <div className="flex gap-2">
          {editing && onDelete && (
            <button
              className="btn-secondary px-4"
              onClick={async () => {
                await onDelete(editing.id)
                onClose()
              }}
              aria-label="Delete expense"
            >
              <svg viewBox="0 0 20 20" className="size-5" fill="currentColor">
                <path d="M8.5 2a1 1 0 00-1 1V4H4.5a.75.75 0 000 1.5h.6l.7 9.1A2.5 2.5 0 008.3 17h3.4a2.5 2.5 0 002.5-2.4l.7-9.1h.6A.75.75 0 0016 4h-3v-.9a1 1 0 00-1-1h-3.5zM8.75 7.5a.75.75 0 011.5 0v5a.75.75 0 01-1.5 0v-5zm3 0a.75.75 0 00-1.5 0v5a.75.75 0 001.5 0v-5z" />
              </svg>
            </button>
          )}
          <button className="btn-primary flex-1" onClick={handleSubmit} disabled={!canSave}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add expense'}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Amount first — it is the one field every expense needs, and leading
            with a big numeric input gets the keyboard into the right mode. */}
        <div>
          <label className="label" htmlFor="expense-amount">
            Amount
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-semibold text-ink-400">
              {symbol}
            </span>
            <input
              id="expense-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="0"
              className="input !py-4 !pl-11 !text-3xl !font-bold tnum"
              aria-invalid={Boolean(errorFor('amount'))}
            />
          </div>
          {errorFor('amount') && <FieldError message={errorFor('amount')!} />}
          {amountMinor !== null && amountMinor < 0 && (
            <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
              Negative amount — recorded as a refund that reduces what people owe.
            </p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="expense-name">
            What was it for?
          </label>
          <input
            id="expense-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dinner at Thalassa"
            className="input"
            autoComplete="off"
            aria-invalid={Boolean(errorFor('name'))}
          />
          {errorFor('name') && <FieldError message={errorFor('name')!} />}
        </div>

        <div>
          <span className="label">Category</span>
          <div className="flex flex-wrap gap-2">
            {visibleCategories.map((category) => (
              <button
                key={category.id}
                onClick={() => setCategoryId(category.id)}
                className={cx(
                  'chip',
                  categoryId === category.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-200',
                )}
                aria-pressed={categoryId === category.id}
              >
                <span aria-hidden="true">{category.icon}</span>
                {category.name}
              </button>
            ))}
          </div>
          {errorFor('categoryId') && <FieldError message={errorFor('categoryId')!} />}
        </div>

        {/* Paid by */}
        <div>
          <div className="flex items-baseline justify-between">
            <span className="label">Paid by</span>
            {payerIds.length > 1 && (
              <span className="text-xs text-ink-500">
                {formatMinor(payerTotal, plan.currency)} of{' '}
                {formatMinor(amountMinor ?? 0, plan.currency)}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {people.map((person) => (
              <button
                key={person.id}
                onClick={() => togglePayer(person.id)}
                className={cx(
                  'chip',
                  payerIds.includes(person.id)
                    ? 'bg-ink-900 text-white dark:bg-white dark:text-ink-900'
                    : 'bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-200',
                )}
                aria-pressed={payerIds.includes(person.id)}
              >
                <Avatar name={person.name} id={person.id} size="xs" />
                {person.name}
              </button>
            ))}
          </div>

          {payerIds.length > 1 && (
            <div className="mt-3 space-y-2 rounded-xl bg-ink-100 dark:bg-ink-900 p-3">
              <p className="text-xs text-ink-500 dark:text-ink-400">
                How much did each of them put in?
              </p>
              {payerIds.map((personId) => (
                <div key={personId} className="flex items-center gap-3">
                  <span className="flex-1 truncate text-sm font-medium">
                    {people.find((p) => p.id === personId)?.name}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={payerAmounts[personId] ?? ''}
                    onChange={(e) =>
                      setPayerAmounts((current) => ({ ...current, [personId]: e.target.value }))
                    }
                    placeholder="0"
                    className="input !w-28 !py-2 text-right tnum"
                  />
                </div>
              ))}
            </div>
          )}
          {errorFor('payers') && <FieldError message={errorFor('payers')!} />}
        </div>

        {/* People involved */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="label !mb-0">
              Split between{' '}
              <span className="text-ink-400 normal-case">({involvedIds.length})</span>
            </span>
            <div className="flex gap-1">
              <QuickButton
                label="All"
                onClick={() => setInvolvedIds(splittable.map((p) => p.id))}
              />
              <QuickButton label="None" onClick={() => setInvolvedIds([])} />
              {payerIds.length === 1 && (
                <QuickButton
                  label="All but payer"
                  onClick={() => setInvolvedIds(splittable.filter((p) => p.id !== payerIds[0]).map((p) => p.id))}
                />
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {splittable.map((person) => (
              <button
                key={person.id}
                onClick={() => toggleInvolved(person.id)}
                className={cx(
                  'chip',
                  involvedIds.includes(person.id)
                    ? 'bg-blue-600 text-white'
                    : 'bg-ink-100 dark:bg-ink-800 text-ink-500 dark:text-ink-400',
                )}
                aria-pressed={involvedIds.includes(person.id)}
              >
                <Avatar name={person.name} id={person.id} size="xs" />
                {person.name}
              </button>
            ))}
          </div>
          {errorFor('shares') && <FieldError message={errorFor('shares')!} />}
        </div>

        {/* Split type + live preview */}
        {involvedIds.length > 0 && (
          <div>
            <span className="label">How to split</span>
            <Segmented
              value={splitType}
              onChange={setSplitType}
              options={SPLIT_OPTIONS}
              ariaLabel="Split type"
            />

            <div className="mt-3 overflow-hidden rounded-xl border border-ink-200 dark:border-ink-800">
              {involvedIds.map((personId, index) => {
                const person = people.find((p) => p.id === personId)
                const share = preview.shares.find((s) => s.personId === personId)
                return (
                  <div
                    key={personId}
                    className={cx(
                      'flex items-center gap-3 px-3 py-2.5',
                      index > 0 && 'border-t border-ink-200 dark:border-ink-800',
                    )}
                  >
                    <Avatar name={person?.name ?? '?'} id={personId} size="xs" />
                    <span className="flex-1 truncate text-sm font-medium">{person?.name}</span>

                    {splitType === 'equal' ? (
                      <Money
                        minor={share?.shareMinor ?? 0}
                        currency={plan.currency}
                        className="text-sm font-semibold"
                        signed
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={splitValues[personId] ?? ''}
                          onChange={(e) =>
                            setSplitValues((current) => ({ ...current, [personId]: e.target.value }))
                          }
                          placeholder={splitType === 'shares' ? '1' : '0'}
                          className="input !w-24 !py-1.5 text-right text-sm tnum"
                          aria-label={`${splitType} value for ${person?.name}`}
                        />
                        {splitType === 'percent' && (
                          <span className="w-4 text-sm text-ink-400">%</span>
                        )}
                        {splitType !== 'percent' && <span className="w-4" />}
                      </div>
                    )}
                  </div>
                )
              })}

              {splitType !== 'equal' && (
                <div className="flex items-center justify-between border-t border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-900 px-3 py-2 text-sm">
                  <span className="font-medium text-ink-500">Resolved total</span>
                  <Money
                    minor={sumMinor(preview.shares.map((s) => s.shareMinor))}
                    currency={plan.currency}
                    className="font-semibold"
                    signed
                  />
                </div>
              )}
            </div>

            {preview.error && <FieldError message={preview.error} />}
          </div>
        )}

        <div>
          <label className="label" htmlFor="expense-date">
            Date
          </label>
          <input
            id="expense-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input"
          />
        </div>

        {showNotes ? (
          <div>
            <label className="label" htmlFor="expense-notes">
              Notes
            </label>
            <textarea
              id="expense-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Anything worth remembering"
              className="input resize-none"
            />
          </div>
        ) : (
          <button
            onClick={() => setShowNotes(true)}
            className="text-sm font-medium text-blue-600 dark:text-blue-400"
          >
            + Add a note
          </button>
        )}

        {duplicateWarning && !dismissedDuplicate && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              {duplicateWarning.message}
            </p>
            <button
              onClick={() => setDismissedDuplicate(true)}
              className="mt-2 text-sm font-semibold text-amber-900 underline dark:text-amber-200"
            >
              Add it anyway
            </button>
          </div>
        )}
      </div>
    </Sheet>
  )
}

function FieldError({ message }: { message: string }) {
  return (
    <p role="alert" className="mt-1.5 text-sm font-medium text-rose-600 dark:text-rose-400">
      {message}
    </p>
  )
}

function QuickButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
    >
      {label}
    </button>
  )
}
