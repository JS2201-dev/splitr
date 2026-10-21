import { buildUpiTargets, buildUpiQr } from './share'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { computeBalances } from '@/domain/balances'
import { minorToDecimalString } from '@/domain/money'
import { buildSettlement } from '@/domain/settlement'
import { summariseAll } from '@/domain/summary'
import type { PlanBundle } from '@/domain/types'
import { formatDisplayDate } from '@/lib/id'
import { safeFilename } from './csv'

/**
 * jsPDF's built-in fonts are the PDF standard 14 (Helvetica et al), which are
 * Latin-1 only — the rupee sign U+20B9 is not in them and renders as garbage.
 * Embedding a Unicode TTF would fix it but adds ~300KB to the bundle for one
 * glyph, which is a bad trade for a mobile-first PWA.
 *
 * So the PDF uses the ISO code ("INR 1,234.50") instead of the symbol. It is
 * unambiguous, it prints correctly everywhere, and it is arguably better for a
 * document someone might forward abroad. The on-screen UI still uses ₹.
 */
function pdfMoney(minor: number, currency: string): string {
  // Format the digits with Intl (so INR gets 1,23,456 grouping and others get
  // 123,456) but supply the ISO code ourselves instead of the symbol.
  const code = currency.toUpperCase()
  const exponent = minorToDecimalString(0, currency).split('.')[1]?.length ?? 0
  const grouped = new Intl.NumberFormat(code === 'INR' ? 'en-IN' : 'en-US', {
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(Math.abs(minor) / 10 ** exponent)

  return `${minor < 0 ? '-' : ''}${code} ${grouped}`
}

const INK = {
  heading: [15, 23, 42] as [number, number, number],
  muted: [100, 116, 139] as [number, number, number],
  accent: [37, 99, 235] as [number, number, number],
  owes: [190, 24, 93] as [number, number, number],
  gets: [15, 118, 110] as [number, number, number],
}

/**
 * Generate the full settlement PDF: expenses, per-person breakdown, and
 * settlement status — the three things someone needs to check the maths.
 */
export function buildPlanPdf(bundle: PlanBundle): jsPDF {
  const { plan, people, categories, expenses, payments } = bundle
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 40

  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? '(removed)'
  const categoryOf = (id: string) => categories.find((c) => c.id === id)?.name ?? 'Uncategorised'
  const money = (v: number) => pdfMoney(v, plan.currency)

  // ---- Header ----
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...INK.heading)
  doc.text(plan.name, margin, 56)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...INK.muted)
  const subtitle = [
    plan.type.charAt(0).toUpperCase() + plan.type.slice(1),
    `${formatDisplayDate(plan.startDate)} – ${formatDisplayDate(plan.endDate)}`,
    `Organizer: ${nameOf(plan.organizerId)}`,
    `${people.length} people · ${expenses.length} expenses`,
  ].join('  ·  ')
  doc.text(subtitle, margin, 74)

  const grandTotal = expenses.reduce((a, e) => a + e.amountMinor, 0)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...INK.accent)
  doc.text(`Total: ${money(grandTotal)}`, pageWidth - margin, 56, { align: 'right' })

  const view = buildSettlement(people, expenses, payments, plan.settlementMode, plan.organizerId)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...(view.settled ? INK.gets : INK.muted))
  doc.text(
    view.settled ? 'Fully settled' : `${money(view.totalRemainingMinor)} outstanding`,
    pageWidth - margin,
    74,
    { align: 'right' },
  )

  let cursorY = 100

  const sectionTitle = (title: string, y: number) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...INK.heading)
    doc.text(title, margin, y)
    return y + 10
  }

  // ---- Expenses ----
  cursorY = sectionTitle('Expenses', cursorY)
  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    head: [['Date', 'Expense', 'Category', 'Paid by', 'Split', 'Amount']],
    body: [...expenses]
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((e) => [
        formatDisplayDate(e.date),
        e.notes ? `${e.name}\n${e.notes}` : e.name,
        categoryOf(e.categoryId),
        e.payers.map((p) => nameOf(p.personId)).join(', '),
        `${e.shares.length} ${e.shares.length === 1 ? 'person' : 'people'} · ${e.splitType}`,
        money(e.amountMinor),
      ]),
    styles: { fontSize: 8, cellPadding: 5, textColor: INK.heading },
    headStyles: { fillColor: [241, 245, 249], textColor: INK.heading, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 250, 252] },
    columnStyles: {
      0: { cellWidth: 48 },
      5: { halign: 'right', fontStyle: 'bold', cellWidth: 80 },
    },
  })

  // ---- Per-person breakdown ----
  const sheet = computeBalances(people, expenses, payments)
  cursorY = sectionTitle('Per-person breakdown', lastY(doc) + 28)
  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    head: [['Person', 'Paid', 'Share', 'Payments made', 'Received', 'Balance']],
    body: people.map((person) => {
      const row = sheet.get(person.id)!
      return [
        person.name,
        money(row.paidMinor),
        money(row.shareMinor),
        money(row.paidOutMinor),
        money(row.receivedMinor),
        row.netMinor === 0
          ? 'Settled'
          : row.netMinor > 0
            ? `Gets back ${money(row.netMinor)}`
            : `Owes ${money(-row.netMinor)}`,
      ]
    }),
    styles: { fontSize: 8, cellPadding: 5, textColor: INK.heading },
    headStyles: { fillColor: [241, 245, 249], textColor: INK.heading, fontStyle: 'bold' },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 5) return
      const text = String(data.cell.raw)
      if (text.startsWith('Owes')) data.cell.styles.textColor = INK.owes
      else if (text.startsWith('Gets')) data.cell.styles.textColor = INK.gets
    },
  })

  // ---- Settlement ----
  const modeLabel = plan.settlementMode === 'collector' ? 'via the organizer' : 'minimal transfers'
  cursorY = sectionTitle(`Settlement status (${modeLabel})`, lastY(doc) + 28)
  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    head: [['From', 'To', 'Amount due', 'Paid', 'Remaining', 'Status']],
    body: view.obligations.map((o) => [
      nameOf(o.fromPersonId),
      nameOf(o.toPersonId),
      money(o.amountMinor),
      money(o.paidMinor),
      money(o.remainingMinor),
      o.status === 'paid' ? 'Paid' : o.status === 'partial' ? 'Partially paid' : 'Pending',
    ]),
    styles: { fontSize: 8, cellPadding: 5, textColor: INK.heading },
    headStyles: { fillColor: [241, 245, 249], textColor: INK.heading, fontStyle: 'bold' },
    columnStyles: {
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right', fontStyle: 'bold' },
      5: { halign: 'center' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 5) return
      const text = String(data.cell.raw)
      if (text === 'Paid') data.cell.styles.textColor = INK.gets
      else if (text === 'Pending') data.cell.styles.textColor = INK.owes
    },
  })

  // ---- Plain-English notes ----
  const summaries = summariseAll(people, expenses, payments, plan.currency)
  if (summaries.length > 0) {
    cursorY = sectionTitle('In plain English', lastY(doc) + 28)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...INK.muted)

    let y = cursorY + 6
    for (const summary of summaries) {
      const lines = doc.splitTextToSize(summary.breakdown, pageWidth - margin * 2)
      if (y + lines.length * 12 > doc.internal.pageSize.getHeight() - 60) {
        doc.addPage()
        y = margin + 10
      }
      doc.text(lines, margin, y)
      y += lines.length * 12 + 8
    }
  }

  // ---- Footers ----
  const pageCount = doc.getNumberOfPages()
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...INK.muted)
    doc.text(
      `${plan.name} · generated ${new Date().toLocaleDateString('en-IN')} · Splitr`,
      margin,
      doc.internal.pageSize.getHeight() - 24,
    )
    doc.text(
      `Page ${page} of ${pageCount}`,
      pageWidth - margin,
      doc.internal.pageSize.getHeight() - 24,
      { align: 'right' },
    )
  }

  return doc
}

/** autoTable stashes the final Y on the doc; this keeps the cast in one place. */
function lastY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 100
}

export async function downloadPlanPdf(bundle: PlanBundle): Promise<void> {
  const doc = buildPlanPdf(bundle)
  const targets = buildUpiTargets(bundle)
  // One compact QR card per pending person; generic UPI supports any payment app.
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]
    if (i % 3 === 0) {
      doc.addPage()
      doc.setFontSize(16)
      doc.setTextColor(...INK.heading)
      doc.text('Payment QR codes', 40, 50)
    }
    const y = 85 + (i % 3) * 230
    const from = bundle.people.find((p) => p.id === target.fromPersonId)?.name ?? '?'
    doc.setFontSize(11)
    doc.text(doc.splitTextToSize(`${from} pays ${target.toName}: ${pdfMoney(target.amountMinor, bundle.plan.currency)}`, 300), 220, y + 25)
    doc.setFontSize(9)
    doc.text(doc.splitTextToSize(target.toUpiId, 300), 220, y + 65)
    doc.textWithLink('Pay with any UPI app', 220, y + 100, { url: target.link })
    doc.addImage(await buildUpiQr(target.link), 'PNG', 40, y, 160, 160)
  }
  if (targets.length) {
    const count = doc.getNumberOfPages()
    for (let page = 1; page <= count; page++) {
      doc.setPage(page)
      doc.setFillColor(255, 255, 255)
      doc.rect(0, doc.internal.pageSize.getHeight() - 38, doc.internal.pageSize.getWidth(), 38, 'F')
      doc.setFontSize(8)
      doc.setTextColor(...INK.muted)
      doc.text(`Splitr · Page ${page} of ${count}`, 40, doc.internal.pageSize.getHeight() - 24)
    }
  }
  doc.save(safeFilename(bundle.plan.name, 'pdf'))
}
