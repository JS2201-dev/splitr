import { useState } from 'react'
import { totalsByCategory } from '@/domain/balances'
import type { PlanBundle } from '@/domain/types'
import { CATEGORY_ICONS } from '@/data/categories'
import { usePlanStore } from '@/store/usePlanStore'
import { useUiStore } from '@/store/useUiStore'
import { Money, Sheet, cx } from './ui'

export function CategoriesSheet({
  open,
  onClose,
  bundle,
}: {
  open: boolean
  onClose: () => void
  bundle: PlanBundle
}) {
  const { plan, categories, expenses } = bundle
  const { addCategory, updateCategory } = usePlanStore()
  const showToast = useUiStore((s) => s.showToast)

  const [newName, setNewName] = useState('')
  const [newIcon, setNewIcon] = useState(CATEGORY_ICONS[0])
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null)

  const totals = totalsByCategory(expenses)
  const totalFor = (categoryId: string) =>
    totals.find((t) => t.categoryId === categoryId) ?? { totalMinor: 0, count: 0 }

  async function handleAdd() {
    if (!newName.trim()) return
    await addCategory(newName, newIcon)
    setNewName('')
    showToast(`Added ${newName.trim()}`)
  }

  return (
    <Sheet open={open} onClose={onClose} size="tall" title="Categories" subtitle={plan.name}>
      <div className="space-y-5">
        <div className="space-y-2">
          {categories.map((category) => {
            const { totalMinor, count } = totalFor(category.id)
            const inUse = count > 0

            return (
              <div key={category.id} className={cx('card p-3', category.hidden && 'opacity-50')}>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() =>
                      setIconPickerFor(iconPickerFor === category.id ? null : category.id)
                    }
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-xl dark:bg-ink-800 pressable"
                    aria-label={`Change icon for ${category.name}`}
                  >
                    {category.icon}
                  </button>

                  <input
                    defaultValue={category.name}
                    onBlur={(e) =>
                      e.target.value.trim() &&
                      e.target.value.trim() !== category.name &&
                      updateCategory(category.id, { name: e.target.value.trim() })
                    }
                    className="min-w-0 flex-1 bg-transparent font-semibold focus:outline-none"
                    aria-label={`Rename ${category.name}`}
                  />

                  <div className="text-right">
                    <Money minor={totalMinor} currency={plan.currency} className="text-sm font-bold" />
                    <p className="text-[10px] uppercase text-ink-400">
                      {count} expense{count === 1 ? '' : 's'}
                    </p>
                  </div>

                  <button
                    onClick={() => updateCategory(category.id, { hidden: !category.hidden })}
                    className="rounded-lg p-2 text-ink-400 hover:bg-ink-100 dark:hover:bg-ink-800"
                    aria-label={category.hidden ? `Show ${category.name}` : `Hide ${category.name}`}
                    title={
                      inUse && !category.hidden
                        ? 'Hiding keeps existing expenses but removes it from the picker'
                        : undefined
                    }
                  >
                    {category.hidden ? (
                      <svg viewBox="0 0 20 20" className="size-5" fill="currentColor">
                        <path d="M3.3 2.3a1 1 0 00-1.4 1.4l14 14a1 1 0 001.4-1.4l-1.9-1.9A9.4 9.4 0 0019 10s-3-6-9-6a8.5 8.5 0 00-4 1L3.3 2.3zM10 14c-6 0-9-4-9-4a9.6 9.6 0 012.4-2.8l2.2 2.2a4 4 0 005.2 5.2l1 1A8 8 0 0110 14z" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 20 20" className="size-5" fill="currentColor">
                        <path d="M10 4c-6 0-9 6-9 6s3 6 9 6 9-6 9-6-3-6-9-6zm0 10a4 4 0 110-8 4 4 0 010 8zm0-2a2 2 0 100-4 2 2 0 000 4z" />
                      </svg>
                    )}
                  </button>
                </div>

                {iconPickerFor === category.id && (
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-ink-200 pt-3 dark:border-ink-800">
                    {CATEGORY_ICONS.map((icon) => (
                      <button
                        key={icon}
                        onClick={() => {
                          updateCategory(category.id, { icon })
                          setIconPickerFor(null)
                        }}
                        className="flex size-9 items-center justify-center rounded-lg text-lg hover:bg-ink-100 dark:hover:bg-ink-800"
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                )}

                {category.hidden && inUse && (
                  <p className="mt-2 text-xs text-ink-500">
                    Hidden from the picker — the {count} existing expense{count === 1 ? '' : 's'}{' '}
                    still count{count === 1 ? 's' : ''} towards the total.
                  </p>
                )}
              </div>
            )
          })}
        </div>

        <div className="card p-4">
          <h3 className="mb-3 font-bold">Add a category</h3>
          <div className="flex gap-2">
            <button
              onClick={() => setIconPickerFor(iconPickerFor === '__new' ? null : '__new')}
              className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-xl dark:bg-ink-800"
              aria-label="Choose an icon"
            >
              {newIcon}
            </button>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="Category name"
              className="input"
              autoComplete="off"
              aria-label="Category name"
            />
          </div>

          {iconPickerFor === '__new' && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {CATEGORY_ICONS.map((icon) => (
                <button
                  key={icon}
                  onClick={() => {
                    setNewIcon(icon)
                    setIconPickerFor(null)
                  }}
                  className="flex size-9 items-center justify-center rounded-lg text-lg hover:bg-ink-100 dark:hover:bg-ink-800"
                >
                  {icon}
                </button>
              ))}
            </div>
          )}

          <button onClick={handleAdd} disabled={!newName.trim()} className="btn-primary mt-3 w-full">
            Add category
          </button>
        </div>

        <p className="text-xs leading-relaxed text-ink-500 dark:text-ink-400">
          Categories can't be deleted, only hidden — deleting one would orphan the expenses filed
          under it. Hiding removes it from the picker while keeping the history intact.
        </p>
      </div>
    </Sheet>
  )
}
