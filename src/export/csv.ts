import { computeBalances } from '@/domain/balances'
import { minorToDecimalString } from '@/domain/money'
import { buildSettlement } from '@/domain/settlement'
import type { PlanBundle } from '@/domain/types'

/**
 * RFC 4180 escaping. The leading-character guard stops spreadsheet apps from
 * interpreting a value like `=cmd` or `+91...` as a formula — a real problem
 * when phone numbers and notes go into a CSV someone opens in Excel.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`
  return text
}

function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(cell).join(',')).join('\r\n')
}

/** Expenses, one row per expense, with the per-person split spelled out. */
export function expensesCsv(bundle: PlanBundle): string {
  const { plan, people, categories, expenses } = bundle
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? '(removed)'
  const categoryOf = (id: string) => categories.find((c) => c.id === id)?.name ?? 'Uncategorised'

  const header = [
    'Date',
    'Expense',
    'Category',
    `Amount (${plan.currency})`,
    'Paid by',
    'Split type',
    'People involved',
    'Per-person shares',
    'Notes',
  ]

  const rows = [...expenses]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((e) => [
      e.date,
      e.name,
      categoryOf(e.categoryId),
      minorToDecimalString(e.amountMinor, plan.currency),
      e.payers.map((p) => `${nameOf(p.personId)} ${minorToDecimalString(p.amountMinor, plan.currency)}`).join('; '),
      e.splitType,
      e.shares.map((s) => nameOf(s.personId)).join('; '),
      e.shares.map((s) => `${nameOf(s.personId)} ${minorToDecimalString(s.shareMinor, plan.currency)}`).join('; '),
      e.notes ?? '',
    ])

  return toCsv([header, ...rows])
}

/** Per-person totals: what they paid, what they consumed, where they stand. */
export function balancesCsv(bundle: PlanBundle): string {
  const { plan, people, expenses, payments } = bundle
  const sheet = computeBalances(people, expenses, payments)

  const header = [
    'Person',
    'Role',
    'UPI ID',
    `Total paid (${plan.currency})`,
    `Total share (${plan.currency})`,
    `Net from expenses (${plan.currency})`,
    `Payments made (${plan.currency})`,
    `Payments received (${plan.currency})`,
    `Current balance (${plan.currency})`,
    'Status',
  ]

  const rows = people.map((person) => {
    const row = sheet.get(person.id)!
    const status = row.netMinor === 0 ? 'Settled' : row.netMinor > 0 ? 'Gets back' : 'Owes'
    const money = (v: number) => minorToDecimalString(v, plan.currency)

    return [
      person.name,
      person.role === 'attendee' ? 'Attendee' : 'Spender only',
      person.upiId ?? '',
      money(row.paidMinor),
      money(row.shareMinor),
      money(row.netFromExpensesMinor),
      money(row.paidOutMinor),
      money(row.receivedMinor),
      money(row.netMinor),
      status,
    ]
  })

  return toCsv([header, ...rows])
}

/** Settlement status: every obligation and how much of it has been paid. */
export function settlementCsv(bundle: PlanBundle): string {
  const { plan, people, expenses, payments } = bundle
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? '(removed)'
  const view = buildSettlement(people, expenses, payments, plan.settlementMode, plan.organizerId)
  const money = (v: number) => minorToDecimalString(v, plan.currency)

  const header = [
    'From',
    'To',
    `Amount due (${plan.currency})`,
    `Paid (${plan.currency})`,
    `Remaining (${plan.currency})`,
    `Credit (${plan.currency})`,
    'Status',
  ]

  const rows = view.obligations.map((o) => [
    nameOf(o.fromPersonId),
    nameOf(o.toPersonId),
    money(o.amountMinor),
    money(o.paidMinor),
    money(o.remainingMinor),
    money(o.creditMinor),
    o.status === 'paid' ? 'Paid' : o.status === 'partial' ? 'Partially paid' : 'Pending',
  ])

  return toCsv([header, ...rows])
}

/** Recorded payments, for reconciling against a bank statement. */
export function paymentsCsv(bundle: PlanBundle): string {
  const { plan, people, payments } = bundle
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? '(removed)'

  const header = ['Date', 'From', 'To', `Amount (${plan.currency})`, 'Method', 'Reference']
  const rows = [...payments]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((p) => [
      p.date,
      nameOf(p.fromPersonId),
      nameOf(p.toPersonId),
      minorToDecimalString(p.amountMinor, plan.currency),
      p.method.toUpperCase(),
      p.reference ?? '',
    ])

  return toCsv([header, ...rows])
}

/**
 * One file containing all four sections, separated by blank lines.
 * Opens cleanly in Excel/Sheets and keeps the whole picture in one attachment.
 */
export function fullCsv(bundle: PlanBundle): string {
  return [
    `# ${bundle.plan.name} — expenses`,
    expensesCsv(bundle),
    '',
    `# ${bundle.plan.name} — per-person breakdown`,
    balancesCsv(bundle),
    '',
    `# ${bundle.plan.name} — settlement status`,
    settlementCsv(bundle),
    '',
    `# ${bundle.plan.name} — recorded payments`,
    paymentsCsv(bundle),
  ].join('\r\n')
}

export function downloadCsv(filename: string, content: string): void {
  // The BOM makes Excel open UTF-8 correctly — without it, ₹ renders as mojibake.
  const blob = new Blob(['﻿', content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function safeFilename(name: string, extension: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'plan'}-${new Date().toISOString().slice(0, 10)}.${extension}`
}
