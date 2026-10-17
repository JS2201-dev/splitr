import { formatMinor } from '@/domain/money'
import { buildSettlement } from '@/domain/settlement'
import { buildUpiLink } from '@/domain/summary'
import type { PlanBundle, Person } from '@/domain/types'
import { formatDisplayDate } from '@/lib/id'

/**
 * Build the plain-text summary people actually paste into the group chat.
 *
 * Kept deliberately short and scannable — a wall of itemised expenses gets
 * ignored, so this leads with what each person owes and keeps the detail to
 * one line each.
 */
export function buildShareText(bundle: PlanBundle): string {
  const { plan, people, expenses, payments } = bundle
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? '(removed)'
  const money = (v: number) => formatMinor(v, plan.currency)

  const view = buildSettlement(people, expenses, payments, plan.settlementMode, plan.organizerId)
  const total = expenses.reduce((a, e) => a + e.amountMinor, 0)

  const lines: string[] = [
    `*${plan.name}* — ${formatDisplayDate(plan.startDate)} to ${formatDisplayDate(plan.endDate)}`,
    `Total spent: ${money(total)} across ${expenses.length} expenses`,
    '',
  ]

  if (view.settled) {
    lines.push('✅ *Everyone is settled up.* Nothing outstanding.')
    return lines.join('\n')
  }

  lines.push(
    plan.settlementMode === 'collector'
      ? `*Settle with ${nameOf(plan.organizerId)}:*`
      : '*Who pays whom:*',
  )

  const pending = view.obligations.filter((o) => o.remainingMinor > 0)
  for (const obligation of pending) {
    const detail =
      obligation.paidMinor > 0
        ? ` _(${money(obligation.paidMinor)} of ${money(obligation.amountMinor)} already paid)_`
        : ''
    lines.push(`• ${nameOf(obligation.fromPersonId)} → ${nameOf(obligation.toPersonId)}: *${money(obligation.remainingMinor)}*${detail}`)
  }

  const done = view.obligations.filter((o) => o.remainingMinor === 0 && o.amountMinor > 0)
  if (done.length > 0) {
    lines.push('', '*Already settled:*')
    for (const obligation of done) {
      lines.push(`• ${nameOf(obligation.fromPersonId)} → ${nameOf(obligation.toPersonId)} ✅`)
    }
  }

  // Only worth including links when the payee actually has a UPI ID on file.
  const payeesWithUpi = new Set(
    pending
      .map((o) => people.find((p) => p.id === o.toPersonId))
      .filter((p): p is Person => Boolean(p?.upiId))
      .map((p) => p.id),
  )
  if (payeesWithUpi.size > 0) {
    lines.push('', '_Open the app for one-tap UPI links._')
  }

  return lines.join('\n')
}

/** Per-person UPI deep link for a pending obligation. */
export interface UpiTarget {
  fromPersonId: string
  toPersonId: string
  toName: string
  toUpiId: string
  amountMinor: number
  link: string
  note: string
}

export function buildUpiTargets(bundle: PlanBundle): UpiTarget[] {
  const { plan, people, expenses, payments } = bundle
  const view = buildSettlement(people, expenses, payments, plan.settlementMode, plan.organizerId)

  const targets: UpiTarget[] = []
  for (const obligation of view.obligations) {
    if (obligation.remainingMinor <= 0) continue
    const payee = people.find((p) => p.id === obligation.toPersonId)
    if (!payee?.upiId) continue

    const note = `${plan.name} settle-up`
    targets.push({
      fromPersonId: obligation.fromPersonId,
      toPersonId: obligation.toPersonId,
      toName: payee.name,
      toUpiId: payee.upiId,
      amountMinor: obligation.remainingMinor,
      note,
      link: buildUpiLink({
        payeeUpiId: payee.upiId,
        payeeName: payee.name,
        amountMinor: obligation.remainingMinor,
        currency: plan.currency,
        note,
      }),
    })
  }

  return targets
}

/**
 * Render a UPI link as a scannable QR data URL.
 * The QR library is imported on demand — most sessions never show a QR, and it
 * has no business sitting in the initial bundle of a mobile PWA.
 */
export async function buildUpiQr(link: string, dark = false): Promise<string> {
  const { default: QRCode } = await import('qrcode')
  return QRCode.toDataURL(link, {
    width: 320,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: dark ? { dark: '#e2e8f0', light: '#0f172a' } : { dark: '#0f172a', light: '#ffffff' },
  })
}

export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

/**
 * Share via the native sheet where available, falling back to the clipboard.
 * Returns how it was handled so the caller can show the right confirmation.
 */
export async function shareText(
  title: string,
  text: string,
): Promise<'shared' | 'copied' | 'failed'> {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title, text })
      return 'shared'
    } catch (error) {
      // AbortError means the user dismissed the sheet — not a failure.
      if ((error as Error).name === 'AbortError') return 'shared'
    }
  }

  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}
