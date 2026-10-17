import { useEffect, useMemo, useState } from 'react'
import { currencySymbol, formatMinor, minorToDecimalString, parseAmountToMinor } from '@/domain/money'
import { validatePayment } from '@/domain/validation'
import { buildUpiLink } from '@/domain/summary'
import type { Obligation } from '@/domain/settlement'
import type { PaymentMethod, PlanBundle } from '@/domain/types'
import { todayIso } from '@/lib/id'
import { buildUpiQr } from '@/export/share'
import type { PaymentInput } from '@/store/usePlanStore'
import { Avatar, Segmented, Sheet } from './ui'

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'upi', label: 'UPI' },
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'other', label: 'Other' },
]

/**
 * Record a payment against a pending balance.
 *
 * Defaults to the full remaining amount, because "paid in full" is what
 * happens most of the time — but the amount stays editable so partial
 * payments are a single edit rather than a separate flow.
 */
export function PaymentSheet({
  open,
  onClose,
  bundle,
  obligation,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  bundle: PlanBundle
  obligation: Obligation | null
  onSubmit: (input: PaymentInput) => Promise<void>
}) {
  const { plan, people } = bundle
  const symbol = currencySymbol(plan.currency)

  const [amountText, setAmountText] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('upi')
  const [reference, setReference] = useState('')
  const [date, setDate] = useState(todayIso())
  const [qr, setQr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const from = people.find((p) => p.id === obligation?.fromPersonId)
  const to = people.find((p) => p.id === obligation?.toPersonId)

  useEffect(() => {
    if (!open || !obligation) return
    setAmountText(minorToDecimalString(obligation.remainingMinor, plan.currency))
    setMethod('upi')
    setReference('')
    setDate(todayIso())
    setAttempted(false)
    setSaving(false)
    setQr(null)
  }, [open, obligation, plan.currency])

  const amountMinor = amountText.trim() ? parseAmountToMinor(amountText, plan.currency) : null

  const upiLink = useMemo(() => {
    if (!to?.upiId || !amountMinor || amountMinor <= 0) return null
    return buildUpiLink({
      payeeUpiId: to.upiId,
      payeeName: to.name,
      amountMinor,
      currency: plan.currency,
      note: `${plan.name} settle-up`,
    })
  }, [to, amountMinor, plan.currency, plan.name])

  // Only build the QR when the user asks for it — it is a canvas render and
  // there is no reason to do it on every keystroke.
  async function toggleQr() {
    if (qr) {
      setQr(null)
      return
    }
    if (!upiLink) return
    setQr(await buildUpiQr(upiLink, document.documentElement.classList.contains('dark')))
  }

  const issues =
    obligation && amountMinor !== null
      ? validatePayment(amountMinor, obligation.fromPersonId, obligation.toPersonId, people)
      : []
  const amountError = attempted
    ? (amountMinor === null ? 'Enter an amount' : issues.find((i) => i.field === 'amount')?.message)
    : undefined

  const overpaying =
    obligation && amountMinor !== null && amountMinor > obligation.remainingMinor

  async function handleSubmit() {
    setAttempted(true)
    if (!obligation || amountMinor === null || issues.length > 0) return

    setSaving(true)
    try {
      await onSubmit({
        fromPersonId: obligation.fromPersonId,
        toPersonId: obligation.toPersonId,
        amountMinor,
        method,
        reference,
        date,
      })
      onClose()
    } catch (error) {
      console.error('Failed to record payment', error)
      setSaving(false)
    }
  }

  if (!obligation || !from || !to) return null

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Record payment"
      subtitle={`${from.name} → ${to.name}`}
      footer={
        <button className="btn-primary w-full" onClick={handleSubmit} disabled={saving}>
          {saving ? 'Saving…' : `Record ${amountMinor ? formatMinor(amountMinor, plan.currency) : 'payment'}`}
        </button>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center justify-center gap-4 rounded-2xl bg-ink-100 dark:bg-ink-900 p-4">
          <div className="text-center">
            <Avatar name={from.name} id={from.id} size="lg" />
            <p className="mt-1.5 text-sm font-semibold">{from.name}</p>
          </div>
          <svg viewBox="0 0 24 24" className="size-6 text-ink-400" fill="currentColor">
            <path d="M13.3 5.3a1 1 0 011.4 0l5 5a1 1 0 010 1.4l-5 5a1 1 0 01-1.4-1.4l3.3-3.3H5a1 1 0 110-2h11.6l-3.3-3.3a1 1 0 010-1.4z" />
          </svg>
          <div className="text-center">
            <Avatar name={to.name} id={to.id} size="lg" />
            <p className="mt-1.5 text-sm font-semibold">{to.name}</p>
          </div>
        </div>

        <div className="rounded-xl border border-ink-200 dark:border-ink-800 px-3 py-2.5 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-500">Originally due</span>
            <span className="tnum font-medium">{formatMinor(obligation.amountMinor, plan.currency)}</span>
          </div>
          {obligation.paidMinor > 0 && (
            <div className="mt-1 flex justify-between">
              <span className="text-ink-500">Already paid</span>
              <span className="tnum font-medium">{formatMinor(obligation.paidMinor, plan.currency)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t border-ink-200 dark:border-ink-800 pt-1">
            <span className="font-semibold">Remaining</span>
            <span className="tnum font-bold">{formatMinor(obligation.remainingMinor, plan.currency)}</span>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="payment-amount">
            Amount paid
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-semibold text-ink-400">
              {symbol}
            </span>
            <input
              id="payment-amount"
              type="text"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              className="input !py-4 !pl-11 !text-3xl !font-bold tnum"
              aria-invalid={Boolean(amountError)}
            />
          </div>
          {amountError && (
            <p role="alert" className="mt-1.5 text-sm font-medium text-rose-600 dark:text-rose-400">
              {amountError}
            </p>
          )}

          <div className="mt-2 flex gap-2">
            <PresetButton
              label="Full"
              onClick={() => setAmountText(minorToDecimalString(obligation.remainingMinor, plan.currency))}
            />
            <PresetButton
              label="Half"
              onClick={() =>
                setAmountText(
                  minorToDecimalString(Math.round(obligation.remainingMinor / 2), plan.currency),
                )
              }
            />
          </div>

          {overpaying && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              More than what's owed — the extra{' '}
              {formatMinor(amountMinor! - obligation.remainingMinor, plan.currency)} is recorded as
              a credit to {from.name}.
            </p>
          )}
        </div>

        <div>
          <span className="label">Method</span>
          <Segmented value={method} onChange={setMethod} options={METHODS} ariaLabel="Payment method" />
        </div>

        {upiLink && (
          <div className="rounded-xl border border-ink-200 dark:border-ink-800 p-3">
            <p className="mb-2 text-sm font-medium">
              Pay {to.name} at{' '}
              <span className="font-mono text-xs text-ink-500">{to.upiId}</span>
            </p>
            <div className="flex gap-2">
              <a href={upiLink} className="btn-primary flex-1 !py-2.5 !text-sm">
                Open UPI app
              </a>
              <button onClick={toggleQr} className="btn-secondary !py-2.5 !text-sm">
                {qr ? 'Hide QR' : 'Show QR'}
              </button>
            </div>
            {qr && (
              <img
                src={qr}
                alt={`UPI QR code to pay ${to.name}`}
                className="mx-auto mt-3 size-48 rounded-lg"
              />
            )}
            <p className="mt-2 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
              Opening a UPI app doesn't tell Splitr the payment went through — record it here once
              it's done.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="payment-date">
              Date
            </label>
            <input
              id="payment-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="payment-ref">
              Reference
            </label>
            <input
              id="payment-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="UTR / note"
              className="input"
              autoComplete="off"
            />
          </div>
        </div>
      </div>
    </Sheet>
  )
}

function PresetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg bg-ink-100 px-3 py-1.5 text-sm font-semibold text-ink-700 dark:bg-ink-800 dark:text-ink-200 pressable"
    >
      {label}
    </button>
  )
}
