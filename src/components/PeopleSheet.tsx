import { useState } from 'react'
import { computeBalances } from '@/domain/balances'
import type { PersonRole, PlanBundle } from '@/domain/types'
import { usePlanStore } from '@/store/usePlanStore'
import { useUiStore } from '@/store/useUiStore'
import { Avatar, Money, Sheet, cx, useConfirm } from './ui'

export function PeopleSheet({
  open,
  onClose,
  bundle,
}: {
  open: boolean
  onClose: () => void
  bundle: PlanBundle
}) {
  const { plan, people, expenses, payments } = bundle
  const { addPerson, updatePerson, removePerson, updatePlan } = usePlanStore()
  const showToast = useUiStore((s) => s.showToast)
  const { confirm, dialog } = useConfirm()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [upiId, setUpiId] = useState('')
  const [role, setRole] = useState<PersonRole>('attendee')
  const [editingId, setEditingId] = useState<string | null>(null)

  const sheet = computeBalances(people, expenses, payments)

  async function handleAdd() {
    if (!name.trim()) return
    await addPerson({ name, phone, upiId, role })
    setName('')
    setPhone('')
    setUpiId('')
    setRole('attendee')
    showToast(`Added ${name.trim()}`)
  }

  async function handleRemove(personId: string, personName: string) {
    const result = await removePerson(personId)
    if (!result.ok) {
      showToast(result.reason ?? 'Cannot remove this person')
      return
    }
    showToast(`Removed ${personName}`)
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} size="tall" title="People" subtitle={plan.name}>
        <div className="space-y-5">
          <div className="space-y-2">
            {people.map((person) => {
              const balance = sheet.get(person.id)!
              const isOrganizer = person.id === plan.organizerId
              const isEditing = editingId === person.id

              return (
                <div key={person.id} className="card p-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={person.name} id={person.id} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate font-semibold">{person.name}</p>
                        {isOrganizer && (
                          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                            Organizer
                          </span>
                        )}
                        {person.role === 'spender_only' && (
                          <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink-600 dark:bg-ink-800 dark:text-ink-300">
                            Spender only
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-ink-500 dark:text-ink-400">
                        {person.upiId || person.phone || 'No contact details'}
                      </p>
                    </div>

                    <div className="text-right">
                      <Money
                        minor={balance.netMinor}
                        currency={plan.currency}
                        tone="auto"
                        className="text-sm font-bold"
                      />
                      <p className="text-[10px] uppercase text-ink-400">
                        {balance.netMinor === 0 ? 'settled' : balance.netMinor > 0 ? 'gets back' : 'owes'}
                      </p>
                    </div>

                    <button
                      onClick={() => setEditingId(isEditing ? null : person.id)}
                      className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"
                      aria-label={`Edit ${person.name}`}
                      aria-expanded={isEditing}
                    >
                      <svg viewBox="0 0 20 20" className="size-4" fill="currentColor">
                        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
                      </svg>
                    </button>
                  </div>

                  {isEditing && (
                    <div className="mt-3 space-y-3 border-t border-ink-200 pt-3 dark:border-ink-800">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          defaultValue={person.name}
                          onBlur={(e) =>
                            e.target.value.trim() &&
                            updatePerson(person.id, { name: e.target.value.trim() })
                          }
                          className="input !py-2 !text-sm"
                          aria-label="Name"
                        />
                        <input
                          defaultValue={person.phone ?? ''}
                          onBlur={(e) => updatePerson(person.id, { phone: e.target.value.trim() })}
                          placeholder="Phone"
                          className="input !py-2 !text-sm"
                          inputMode="tel"
                          aria-label="Phone"
                        />
                      </div>
                      <input
                        defaultValue={person.upiId ?? ''}
                        onBlur={(e) => updatePerson(person.id, { upiId: e.target.value.trim() })}
                        placeholder="UPI ID (name@bank)"
                        className="input !py-2 !text-sm"
                        autoComplete="off"
                        aria-label="UPI ID"
                      />

                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() =>
                            updatePerson(person.id, {
                              role: person.role === 'attendee' ? 'spender_only' : 'attendee',
                            })
                          }
                          className="btn-secondary !py-1.5 !px-3 !text-xs"
                        >
                          {person.role === 'attendee' ? 'Make spender-only' : 'Make attendee'}
                        </button>

                        {!isOrganizer && (
                          <>
                            <button
                              onClick={async () => {
                                if (
                                  await confirm(
                                    `Make ${person.name} the organizer? Everyone will settle with them instead.`,
                                    { confirmLabel: 'Make organizer' },
                                  )
                                ) {
                                  await updatePlan({ organizerId: person.id })
                                  showToast(`${person.name} is now the organizer`)
                                }
                              }}
                              className="btn-secondary !py-1.5 !px-3 !text-xs"
                            >
                              Make organizer
                            </button>
                            <button
                              onClick={async () => {
                                if (
                                  await confirm(`Remove ${person.name} from this plan?`, {
                                    confirmLabel: 'Remove',
                                    destructive: true,
                                  })
                                ) {
                                  await handleRemove(person.id, person.name)
                                  setEditingId(null)
                                }
                              }}
                              className="btn-ghost !py-1.5 !px-3 !text-xs !text-rose-600 dark:!text-rose-400"
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="card p-4">
            <h3 className="mb-3 font-bold">Add someone</h3>
            <div className="space-y-2.5">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                placeholder="Name"
                className="input"
                autoComplete="off"
                aria-label="Name"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone (optional)"
                  className="input"
                  inputMode="tel"
                  aria-label="Phone"
                />
                <input
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  placeholder="UPI ID (optional)"
                  className="input"
                  autoComplete="off"
                  aria-label="UPI ID"
                />
              </div>

              <div className="flex gap-2">
                {(['attendee', 'spender_only'] as PersonRole[]).map((value) => (
                  <button
                    key={value}
                    onClick={() => setRole(value)}
                    className={cx(
                      'chip flex-1 justify-center',
                      role === value
                        ? 'bg-blue-600 text-white'
                        : 'bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300',
                    )}
                  >
                    {value === 'attendee' ? 'Attendee' : 'Spender only'}
                  </button>
                ))}
              </div>
              <p className="text-xs leading-relaxed text-ink-500 dark:text-ink-400">
                A <strong>spender-only</strong> person can pay for things but is never added to a
                split by default — useful for someone covering costs who isn't on the trip.
              </p>

              <button onClick={handleAdd} disabled={!name.trim()} className="btn-primary w-full">
                Add person
              </button>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-ink-500 dark:text-ink-400">
            Adding someone now won't change any existing expense — they start at a zero balance and
            are included in whatever you add next. Someone with an outstanding balance can't be
            removed until they're settled.
          </p>
        </div>
      </Sheet>
      {dialog}
    </>
  )
}
