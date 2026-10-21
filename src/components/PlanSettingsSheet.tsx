import { useEffect, useRef, useState } from 'react'
import { formatMinor } from '@/domain/money'
import type { PlanBundle, PlanType } from '@/domain/types'
import {
  BackupError,
  downloadBackup,
  inspectBackup,
  type BackupInspection,
} from '@/export/backup'
import { formatDisplayDate } from '@/lib/id'
import { usePlanStore } from '@/store/usePlanStore'
import { useUiStore } from '@/store/useUiStore'
import { Sheet, cx, useConfirm } from './ui'

const PLAN_TYPES: { value: PlanType; label: string; icon: string }[] = [
  { value: 'trip', label: 'Trip', icon: '✈️' },
  { value: 'outing', label: 'Outing', icon: '🍿' },
  { value: 'party', label: 'Party', icon: '🎉' },
  { value: 'other', label: 'Other', icon: '📋' },
]

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'JPY']

export function PlanSettingsSheet({
  open,
  onClose,
  bundle,
}: {
  open: boolean
  onClose: () => void
  bundle: PlanBundle
}) {
  const { plan } = bundle
  const { updatePlan, changeCurrency, restoreBundle } = usePlanStore()
  const showToast = useUiStore((s) => s.showToast)
  const { confirm, dialog } = useConfirm()
  const fileInput = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(plan.name)
  const [type, setType] = useState<PlanType>(plan.type)
  const [startDate, setStartDate] = useState(plan.startDate)
  const [endDate, setEndDate] = useState(plan.endDate)
  const [pending, setPending] = useState<BackupInspection | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(plan.name)
    setType(plan.type)
    setStartDate(plan.startDate)
    setEndDate(plan.endDate)
    setPending(null)
    setImportError(null)
  }, [open, plan])

  const dirty =
    name.trim() !== plan.name ||
    type !== plan.type ||
    startDate !== plan.startDate ||
    endDate !== plan.endDate

  async function saveDetails() {
    if (!name.trim()) return
    await updatePlan({ name: name.trim(), type, startDate, endDate })
    showToast('Plan updated')
  }

  async function pickCurrency(currency: string) {
    if (currency === plan.currency) return

    const ok = await confirm(
      `Change the currency from ${plan.currency} to ${currency}?\n\n` +
        'This relabels the amounts — it does NOT convert them at an exchange rate. ' +
        `An expense of ${formatMinor(100000, plan.currency)} becomes ${formatMinor(100000, currency)}.`,
      { confirmLabel: `Switch to ${currency}` },
    )
    if (!ok) return

    await changeCurrency(currency)
    showToast(`Currency is now ${currency}`)
  }

  async function handleFile(file: File) {
    setImportError(null)
    setPending(null)
    try {
      setPending(inspectBackup(await file.text()))
    } catch (error) {
      setImportError(
        error instanceof BackupError ? error.message : 'Could not read that file',
      )
    }
  }

  async function runImport(mode: 'replace' | 'copy') {
    if (!pending) return

    const ok = await confirm(
      mode === 'replace'
        ? `Replace "${pending.planName}" with the backup? Anything added since the backup was taken will be lost.`
        : `Import "${pending.planName}" as a separate plan? Your current plans are left untouched.`,
      { confirmLabel: mode === 'replace' ? 'Replace' : 'Import a copy', destructive: mode === 'replace' },
    )
    if (!ok) return

    await restoreBundle(pending.bundle, mode)
    showToast(mode === 'replace' ? 'Plan restored' : 'Backup imported as a new plan')
    setPending(null)
    onClose()
  }

  // Does the backup target a plan that already exists? Only then is an
  // in-place replace meaningful.
  const existingPlans = usePlanStore((s) => s.plans)
  const collides = pending ? existingPlans.some((p) => p.id === pending.bundle.plan.id) : false

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        size="tall"
        title="Plan settings"
        subtitle={plan.name}
        footer={
          dirty ? (
            <button onClick={saveDetails} disabled={!name.trim()} className="btn-primary w-full">
              Save changes
            </button>
          ) : undefined
        }
      >
        <div className="space-y-6">
          <section className="space-y-4">
            <div>
              <label className="label" htmlFor="settings-name">
                Plan name
              </label>
              <input
                id="settings-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
                autoComplete="off"
              />
            </div>

            <div>
              <span className="label">Type</span>
              <div className="grid grid-cols-4 gap-2">
                {PLAN_TYPES.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setType(option.value)}
                    className={cx(
                      'flex flex-col items-center gap-1 rounded-xl py-3 text-xs font-semibold transition active:scale-95',
                      type === option.value
                        ? 'bg-blue-600 text-white'
                        : 'bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300',
                    )}
                    aria-pressed={type === option.value}
                  >
                    <span className="text-xl" aria-hidden="true">
                      {option.icon}
                    </span>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="settings-start">
                  Starts
                </label>
                <input
                  id="settings-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value)
                    if (e.target.value > endDate) setEndDate(e.target.value)
                  }}
                  className="input"
                />
              </div>
              <div>
                <label className="label" htmlFor="settings-end">
                  Ends
                </label>
                <input
                  id="settings-end"
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="input"
                />
              </div>
            </div>

            <div>
              <span className="label">Currency</span>
              <div className="flex flex-wrap gap-2">
                {CURRENCIES.map((code) => (
                  <button
                    key={code}
                    onClick={() => pickCurrency(code)}
                    className={cx(
                      'chip',
                      plan.currency === code
                        ? 'bg-blue-600 text-white'
                        : 'bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300',
                    )}
                    aria-pressed={plan.currency === code}
                  >
                    {code}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                Changing this relabels amounts; it doesn't convert them. Real exchange-rate
                support is Phase 2.
              </p>
            </div>
          </section>

          {/* ---- Backup & restore ---- */}
          <section className="border-t border-ink-200 pt-5 dark:border-ink-800">
            <h3 className="font-bold">Backup &amp; restore</h3>
            <p className="mt-1 mb-3 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
              Your data lives only on this device. Clearing browser data — or iOS evicting storage
              from an app you haven't opened in a week — will erase it. Excel and PDF are reports and
              can't be loaded back; this file can.
            </p>

            <div className="space-y-2">
              <button
                onClick={() => {
                  downloadBackup(bundle)
                  showToast('Backup downloaded')
                }}
                className="btn-primary w-full"
              >
                Back up this plan
              </button>

              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleFile(file)
                  // Reset so re-picking the same file fires onChange again.
                  e.target.value = ''
                }}
              />
              <button onClick={() => fileInput.current?.click()} className="btn-secondary w-full">
                Restore from a backup…
              </button>
            </div>

            {importError && (
              <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 p-3 dark:border-rose-500/30 dark:bg-rose-500/10">
                <p className="text-sm font-medium text-rose-900 dark:text-rose-200">{importError}</p>
              </div>
            )}

            {pending && (
              <div className="mt-3 rounded-xl border border-ink-200 p-3 dark:border-ink-800">
                <p className="font-semibold">{pending.planName}</p>
                <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
                  {pending.peopleCount} people · {pending.expenseCount} expenses ·{' '}
                  {pending.paymentCount} payments
                  <br />
                  {formatMinor(pending.totalExpenseMinor, pending.currency)} total · backed up{' '}
                  {pending.exportedAt !== 'unknown'
                    ? formatDisplayDate(pending.exportedAt.slice(0, 10))
                    : 'at an unknown time'}
                </p>

                {pending.warnings.map((warning, i) => (
                  <p key={i} className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    {warning}
                  </p>
                ))}

                <div className="mt-3 space-y-2">
                  <button onClick={() => runImport('copy')} className="btn-primary w-full !py-2.5 !text-sm">
                    Import as a new plan
                  </button>
                  {collides && (
                    <button
                      onClick={() => runImport('replace')}
                      className="btn-secondary w-full !py-2.5 !text-sm"
                    >
                      Replace the existing "{pending.planName}"
                    </button>
                  )}
                  <button
                    onClick={() => setPending(null)}
                    className="btn-ghost w-full !py-2 !text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </Sheet>
      {dialog}
    </>
  )
}
