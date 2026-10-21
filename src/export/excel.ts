import { strToU8, zipSync } from 'fflate'
import { computeBalances } from '@/domain/balances'
import { buildSettlement } from '@/domain/settlement'
import { currencyExponent } from '@/domain/money'
import type { PlanBundle } from '@/domain/types'
import { safeFilename } from './csv'

type Cell = string | number
const xml = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

/** Real OOXML workbook. Text uses inline strings, never formulas. */
export function buildPlanExcel(bundle: PlanBundle): Uint8Array {
  const { plan, people, categories, expenses, payments } = bundle
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? '(removed)'
  const money = (v: number) => v / 10 ** currencyExponent(plan.currency)
  const amount = `Amount (${plan.currency})`
  const balances = computeBalances(people, expenses, payments)
  const settlement = buildSettlement(people, expenses, payments, plan.settlementMode, plan.organizerId)
  const sheets: { name: string; rows: Cell[][]; moneyColumns: number[] }[] = [
    { name: 'Balances', moneyColumns: [2, 3, 4, 5, 6], rows: [
      ['Person', 'UPI ID', `Paid (${plan.currency})`, 'Share', 'Payments made', 'Received', 'Balance'],
      ...people.map((p) => { const b = balances.get(p.id)!; return [p.name, p.upiId ?? '', ...[b.paidMinor, b.shareMinor, b.paidOutMinor, b.receivedMinor, b.netMinor].map(money)] }),
    ] },
    { name: 'Expenses', moneyColumns: [3], rows: [
      ['Date', 'Expense', 'Category', amount, 'Paid by', 'Split type', 'Per-person shares', 'Notes'],
      ...[...expenses].sort((a, b) => a.date.localeCompare(b.date)).map((e) => [e.date, e.name, categories.find((c) => c.id === e.categoryId)?.name ?? 'Uncategorised', money(e.amountMinor), e.payers.map((p) => `${name(p.personId)}: ${money(p.amountMinor)}`).join('; '), e.splitType, e.shares.map((s) => `${name(s.personId)}: ${money(s.shareMinor)}`).join('; '), e.notes ?? '']),
    ] },
    { name: 'Settlement', moneyColumns: [2, 3, 4, 5], rows: [
      ['From', 'To', amount, 'Paid', 'Remaining', 'Credit', 'Status'],
      ...settlement.obligations.map((o) => [name(o.fromPersonId), name(o.toPersonId), ...[o.amountMinor, o.paidMinor, o.remainingMinor, o.creditMinor].map(money), o.status]),
    ] },
    { name: 'Payments', moneyColumns: [3], rows: [
      ['Date', 'From', 'To', amount, 'Method', 'Reference'],
      ...payments.map((p) => [p.date, name(p.fromPersonId), name(p.toPersonId), money(p.amountMinor), p.method.toUpperCase(), p.reference ?? '']),
    ] },
  ]
  const files: Record<string, Uint8Array> = {}
  const put = (path: string, text: string) => { files[path] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${text}`) }
  put('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`)
  put('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  put('xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`)
  put('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)
  const numberFormat = `#,##0${currencyExponent(plan.currency) ? '.' + '0'.repeat(currencyExponent(plan.currency)) : ''};[Red](#,##0${currencyExponent(plan.currency) ? '.' + '0'.repeat(currencyExponent(plan.currency)) : ''});&quot;—&quot;`
  put('xl/styles.xml', `<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="${numberFormat}"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf fontId="0" fillId="0" borderId="0" xfId="0"/><xf fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`)
  sheets.forEach((sheet, i) => {
    const endColumn = String.fromCharCode(64 + sheet.rows[0].length)
    put(`xl/worksheets/sheet${i + 1}.xml`, `<worksheet xmlns="${ns}"><dimension ref="A1:${endColumn}${sheet.rows.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${sheet.rows[0].map((_, c) => `<col min="${c + 1}" max="${c + 1}" width="${c === 0 ? 22 : 30}" customWidth="1"/>`).join('')}</cols><sheetData>${sheet.rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => {
      const ref = `${String.fromCharCode(65 + c)}${r + 1}`
      const style = r === 0 ? 1 : sheet.moneyColumns.includes(c) ? 2 : 0
      return typeof value === 'number' ? `<c r="${ref}" s="${style}"><v>${value}</v></c>` : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`
    }).join('')}</row>`).join('')}</sheetData><autoFilter ref="A1:${endColumn}${sheet.rows.length}"/></worksheet>`)
  })
  return zipSync(files)
}

export function downloadPlanExcel(bundle: PlanBundle): void {
  const bytes = buildPlanExcel(bundle)
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const link = document.createElement('a')
  link.href = url
  link.download = safeFilename(bundle.plan.name, 'xlsx')
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
