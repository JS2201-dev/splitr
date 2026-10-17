import { useState } from 'react'
import type { PlanType } from '@/domain/types'
import { addDays, todayIso } from '@/lib/id'
import { usePlanStore } from '@/store/usePlanStore'
import { useUiStore } from '@/store/useUiStore'
import { Sheet, cx, useConfirm } from './ui'

const PLAN_TYPES: { value: PlanType; label: string; icon: string }[] = [
  { value: 'trip', label: 'Trip', icon: '✈️' },
  { value: 'outing', label: 'Outing', icon: '🍿' },
  { value: 'party', label: 'Party', icon: '🎉' },
  { value: 'other', label: 'Other', icon: '📋' },
]

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD']

export function PlansSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { plans, activePlanId, selectPlan, createPlan, setPlanStatus, deletePlan } = usePlanStore()
  const showToast = useUiStore((s) => s.showToast)
  const { confirm, dialog } = useConfirm()

  const [creating, setCreating] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  const [name, setName] = useState('')
  const [type, setType] = useState<PlanType>('trip')
  const [currency, setCurrency] = useState('INR')
  const [startDate, setStartDate] = useState(todayIso())
  const [endDate, setEndDate] = useState(addDays(todayIso(), 2))
  const [organizerName, setOrganizerName] = useState('')
  const [attendees, setAttendees] = useState('')

  const active = plans.filter((p) => p.status !== 'archived')
  const archived = plans.filter((p) => p.status === 'archived')

  async function handleCreate() {
    if (!name.trim() || !organizerName.trim()) return
    await createPlan({
      name,
      type,
      currency,
      startDate,
      endDate,
      organizerName,
      attendeeNames: attendees
        .split(/[,\n]/)
        .map((a) => a.trim())
        .filter(Boolean),
    })
    setCreating(false)
    setName('')
    setOrganizerName('')
    setAttendees('')
    showToast('Plan created')
    onClose()
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        size="tall"
        title={creating ? 'New plan' : 'Your plans'}
        subtitle={creating ? undefined : `${active.length} active`}
        footer={
          creating ? (
            <div className="flex gap-2">
              <button onClick={() => setCreating(false)} className="btn-secondary flex-1">
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || !organizerName.trim()}
                className="btn-primary flex-1"
              >
                Create plan
              </button>
            </div>
          ) : (
            <button onClick={() => setCreating(true)} className="btn-primary w-full">
              + New plan
            </button>
          )
        }
      >
        {creating ? (
          <div className="space-y-5">
            <div>
              <label className="label" htmlFor="plan-name">
                Plan name
              </label>
              <input
                id="plan-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Goa Trip"
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
                <label className="label" htmlFor="plan-start">
                  Starts
                </label>
                <input
                  id="plan-start"
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
                <label className="label" htmlFor="plan-end">
                  Ends
                </label>
                <input
                  id="plan-end"
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
                    onClick={() => setCurrency(code)}
                    className={cx(
                      'chip',
                      currency === code
                        ? 'bg-blue-600 text-white'
                        : 'bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300',
                    )}
                    aria-pressed={currency === code}
                  >
                    {code}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label" htmlFor="plan-organizer">
                Organizer (you)
              </label>
              <input
                id="plan-organizer"
                value={organizerName}
                onChange={(e) => setOrganizerName(e.target.value)}
                placeholder="Your name"
                className="input"
                autoComplete="name"
              />
              <p className="mt-1.5 text-xs text-ink-500 dark:text-ink-400">
                In "via organizer" mode, everyone settles with this person.
              </p>
            </div>

            <div>
              <label className="label" htmlFor="plan-attendees">
                Who else is coming?
              </label>
              <textarea
                id="plan-attendees"
                value={attendees}
                onChange={(e) => setAttendees(e.target.value)}
                rows={3}
                placeholder="Anu, Vikram, Priya, Sam"
                className="input resize-none"
              />
              <p className="mt-1.5 text-xs text-ink-500 dark:text-ink-400">
                Comma or line separated. You can add more people later.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              {active.map((plan) => (
                <div
                  key={plan.id}
                  className={cx(
                    'card p-3',
                    plan.id === activePlanId && 'ring-2 ring-blue-500',
                  )}
                >
                  <button
                    onClick={async () => {
                      await selectPlan(plan.id)
                      onClose()
                    }}
                    className="flex w-full items-center gap-3 text-left"
                  >
                    <span className="text-2xl" aria-hidden="true">
                      {PLAN_TYPES.find((t) => t.value === plan.type)?.icon ?? '📋'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{plan.name}</p>
                      <p className="text-xs text-ink-500 dark:text-ink-400">
                        {plan.currency} ·{' '}
                        {plan.status === 'settled' ? 'Settled' : 'Active'}
                      </p>
                    </div>
                    {plan.status === 'settled' && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                        Settled
                      </span>
                    )}
                  </button>

                  <div className="mt-2 flex gap-2 border-t border-ink-200 pt-2 dark:border-ink-800">
                    <button
                      onClick={async () => {
                        await selectPlan(plan.id)
                        await setPlanStatus('archived')
                        showToast(`Archived ${plan.name}`)
                      }}
                      className="btn-ghost !py-1 !px-2 !text-xs"
                    >
                      Archive
                    </button>
                    <button
                      onClick={async () => {
                        if (
                          await confirm(
                            `Delete "${plan.name}" and all its expenses? This can't be undone.`,
                            { confirmLabel: 'Delete', destructive: true },
                          )
                        ) {
                          await deletePlan(plan.id)
                          showToast('Plan deleted')
                        }
                      }}
                      className="btn-ghost !py-1 !px-2 !text-xs !text-rose-600 dark:!text-rose-400"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {archived.length > 0 && (
              <div>
                <button
                  onClick={() => setShowArchived(!showArchived)}
                  className="flex w-full items-center justify-between px-1 py-2 text-xs font-bold uppercase tracking-wide text-ink-500 dark:text-ink-400"
                  aria-expanded={showArchived}
                >
                  Archive ({archived.length})
                  <svg
                    viewBox="0 0 20 20"
                    className={cx('size-4 transition-transform', showArchived && 'rotate-180')}
                    fill="currentColor"
                  >
                    <path d="M5.3 7.3a1 1 0 011.4 0L10 10.6l3.3-3.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 010-1.4z" />
                  </svg>
                </button>

                {showArchived && (
                  <div className="space-y-2">
                    {archived.map((plan) => (
                      <div key={plan.id} className="card flex items-center gap-3 p-3 opacity-70">
                        <span className="text-xl" aria-hidden="true">
                          {PLAN_TYPES.find((t) => t.value === plan.type)?.icon ?? '📋'}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">{plan.name}</span>
                        <button
                          onClick={async () => {
                            await selectPlan(plan.id)
                            await setPlanStatus('active')
                            showToast(`Restored ${plan.name}`)
                            onClose()
                          }}
                          className="btn-secondary !py-1 !px-2.5 !text-xs"
                        >
                          Restore
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Sheet>
      {dialog}
    </>
  )
}
