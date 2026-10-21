import { useEffect, useMemo, useState } from 'react'
import type { PlanBundle } from '@/domain/types'
import { buildSettlement } from '@/domain/settlement'
import { formatMinor, minorToDecimalString, parseAmountToMinor } from '@/domain/money'
import { todayIso } from '@/lib/id'
import { parseMessage } from '@/integrations/registry'
import { matchIncomingPayment } from '@/integrations/reconcile'
import type { ParseResult } from '@/integrations/types'
import type { PaymentInput } from '@/store/usePlanStore'
import type { ExpenseSheetPrefill } from './ExpenseSheet'
import { Sheet } from './ui'

export function MessageCaptureSheet({ open, onClose, bundle, onExpense, onPayment }: {
  open: boolean; onClose: () => void; bundle: PlanBundle
  onExpense: (prefill: ExpenseSheetPrefill) => void
  onPayment: (input: PaymentInput) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<ParseResult | null>(null)
  const [kind, setKind] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayIso())
  const [target, setTarget] = useState('')
  const [method, setMethod] = useState<'upi' | 'bank'>('upi')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setText(''); setResult(null); setError(''); setBusy(false) } }, [open])
  const candidate = result?.candidate
  const pending = useMemo(() => {
    const { plan, people, expenses, payments } = bundle
    return buildSettlement(people, expenses, payments, plan.settlementMode, plan.organizerId).obligations.filter((o) => o.remainingMinor > 0)
  }, [bundle])
  const matches = candidate ? matchIncomingPayment(candidate, bundle) : []
  const nameOf = (id: string) => bundle.people.find((p) => p.id === id)?.name ?? '?'
  const selected = pending.find((o) => o.id === target)
  const minor = parseAmountToMinor(amount, bundle.plan.currency)
  const duplicate = Boolean(reference.trim() && bundle.payments.some((p) => p.reference?.toLowerCase() === reference.trim().toLowerCase()))

  async function analyze() {
    setBusy(true); setError('')
    try {
      const parsed = await parseMessage({ id: crypto.randomUUID(), body: text, channel: 'manual_paste', receivedAt: new Date().toISOString() }, {
        planId: bundle.plan.id, currency: bundle.plan.currency, people: bundle.people, categories: bundle.categories.filter((c) => !c.hidden),
      })
      setResult(parsed)
      const c = parsed.candidate
      setKind(c?.direction === 'credit' ? 'payment' : c?.direction === 'debit' ? 'expense' : '')
      setAmount(c?.amountMinor ? minorToDecimalString(c.amountMinor, bundle.plan.currency) : '')
      setDate(c?.date ?? todayIso())
      setMethod(/\bupi\b|@[a-z]/i.test(text) ? 'upi' : 'bank')
      const proposed = c ? matchIncomingPayment(c, bundle) : []
      setTarget(proposed.length === 1 ? proposed[0].id : '')
      setReference(/\b(?:UTR|UPI\s+ref(?:erence)?|ref(?:erence)?(?:\s+no)?)[\s:#.-]*([a-z0-9]{6,})\b/i.exec(text)?.[1] ?? '')
    } catch { setError('Could not read this message. Please try again.') }
    finally { setBusy(false) }
  }

  async function confirmPayment() {
    if (!selected || !minor || minor <= 0 || !date || minor > selected.remainingMinor || duplicate) return
    setBusy(true); setError('')
    try {
      await onPayment({ fromPersonId: selected.fromPersonId, toPersonId: selected.toPersonId, amountMinor: minor, date, method, reference: reference.trim() })
      onClose()
    } catch { setError('Could not save the payment. Try again.') }
    finally { setBusy(false) }
  }

  return <Sheet open={open} onClose={onClose} title="Capture a message" subtitle="Paste a bank SMS, UPI alert or email">
    <div className="space-y-4">
      <label className="label" htmlFor="capture-text">Message</label>
      <textarea id="capture-text" className="input" rows={5} value={text} maxLength={12000} onChange={(e) => { setText(e.target.value); setResult(null); setError('') }} placeholder="INR 650 debited at Swiggy on 21/10/2026 #goa #food @rahul @anu" />
      <p className="text-xs text-ink-500">Parsed on this device. Nothing saves until you review and confirm. #category selects a category; @names select split participants. The current plan receives the expense.</p>
      <button className="btn-primary w-full" disabled={!text.trim() || busy} onClick={analyze}>{busy ? 'Reading…' : 'Read message'}</button>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {result && !candidate && <p role="alert">No details could be extracted. Check that message parsing is enabled.</p>}
      {candidate && <div className="space-y-4 rounded-xl border border-ink-200 p-3 dark:border-ink-800">
        <p className="font-semibold">Review extracted details · {Math.round(result!.confidence * 100)}% confidence</p>
        <p className="text-sm">{candidate.merchant ?? 'Name needs review'} · {candidate.amountMinor ? formatMinor(candidate.amountMinor, bundle.plan.currency) : 'Amount needs review'} · {candidate.date ?? 'Date needs review'}</p>
        {result!.notes?.map((note) => <p className="text-xs text-amber-600 dark:text-amber-400" key={note}>{note}</p>)}
        <label className="label" htmlFor="capture-kind">Save as</label>
        <select id="capture-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Choose what happened</option><option value="expense">Expense / money spent</option><option value="payment">Repayment / money received</option>
        </select>
        {kind === 'expense' && <button className="btn-primary w-full" onClick={() => onExpense({ source: 'parsed', name: candidate.merchant, amountMinor: candidate.amountMinor, categoryId: candidate.suggestedCategoryId, date: candidate.date, notes: candidate.note, involvedIds: candidate.suggestedPersonIds?.length ? candidate.suggestedPersonIds : undefined })}>Review expense details</button>}
        {kind === 'payment' && <>
          <p className="text-sm">{matches.length === 1 ? `Possible match: mark ${nameOf(matches[0].fromPersonId)} paid ${candidate.amountMinor ? formatMinor(candidate.amountMinor, bundle.plan.currency) : ''}?` : 'Choose the balance this payment belongs to. Amount alone does not identify a payer.'}</p>
          <label className="label" htmlFor="capture-balance">Pending balance</label>
          <select id="capture-balance" className="input" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Select payer and recipient</option>{pending.map((o) => <option key={o.id} value={o.id}>{nameOf(o.fromPersonId)} → {nameOf(o.toPersonId)} · {formatMinor(o.remainingMinor, bundle.plan.currency)}</option>)}</select>
          <label className="label" htmlFor="capture-amount">Amount received ({bundle.plan.currency})</label>
          <input id="capture-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {selected && minor !== null && minor > selected.remainingMinor && <p className="text-sm text-amber-600">This exceeds the pending balance. Use Record payment to review an overpayment.</p>}
          <label className="label" htmlFor="capture-date">Payment date</label>
          <input id="capture-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          <label className="label" htmlFor="capture-method">Payment method</label>
          <select id="capture-method" className="input" value={method} onChange={(e) => setMethod(e.target.value as 'upi' | 'bank')}><option value="upi">UPI</option><option value="bank">Bank</option></select>
          <label className="label" htmlFor="capture-ref">UTR / reference</label>
          <input id="capture-ref" className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
          {duplicate && <p role="alert" className="text-sm text-rose-600">This reference has already been recorded.</p>}
          <p className="text-xs text-ink-500">Confirm the sender, recipient and amount against your bank record before saving.</p>
          <button className="btn-primary w-full" onClick={confirmPayment} disabled={busy || !selected || !minor || minor <= 0 || minor > selected.remainingMinor || !date || duplicate}>{busy ? 'Saving…' : 'Confirm payment received'}</button>
        </>}
      </div>}
    </div>
  </Sheet>
}
