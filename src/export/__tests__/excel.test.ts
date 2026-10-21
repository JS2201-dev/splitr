import { describe, expect, it } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { buildDemoBundle } from '@/data/seed'
import { buildPlanExcel } from '../excel'
import { buildReminderText, buildUpiTargets } from '../share'

describe('Excel export', () => {
  it('creates a zipped OOXML workbook with four related worksheets and numeric monetary cells', () => {
    const files = unzipSync(buildPlanExcel(buildDemoBundle()))
    expect(Object.keys(files).filter((p) => p.startsWith('xl/worksheets/'))).toHaveLength(4)
    expect(strFromU8(files['xl/workbook.xml'])).toContain('name="Balances"')
    const expenses = strFromU8(files['xl/worksheets/sheet2.xml'])
    expect(expenses).toContain('state="frozen"')
    expect(expenses).toMatch(/<c r="D2" s="2"><v>\d/)
    expect(strFromU8(files['[Content_Types].xml'])).toContain('spreadsheetml.sheet.main+xml')
  })
  it('preserves Unicode and formula-like text as strings, escapes XML', () => {
    const bundle = buildDemoBundle()
    bundle.expenses[0].name = '=HYPERLINK("unsafe") & ₹ <Dinner>'
    const files = unzipSync(buildPlanExcel(bundle))
    const sheet = strFromU8(files['xl/worksheets/sheet2.xml'])
    expect(sheet).toContain('=HYPERLINK(&quot;unsafe&quot;) &amp; ₹ &lt;Dinner&gt;')
    expect(sheet).not.toContain('<f>')
  })
  it('makes reminder drafts only for pending balances', () => {
    const bundle = buildDemoBundle()
    const target = buildUpiTargets(bundle)[0]
    expect(target).toBeDefined()
    expect(buildReminderText(bundle, target.fromPersonId, target.toPersonId)).toContain('is pending')
    expect(buildReminderText(bundle, 'missing', 'missing')).toBeNull()
  })
})
