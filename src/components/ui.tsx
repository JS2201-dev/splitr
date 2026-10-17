import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { formatMinor } from '@/domain/money'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Money display with consistent direction colouring.
 * `tone="auto"` turns negative amounts warm and positive amounts cool.
 */
export function Money({
  minor,
  currency,
  tone = 'plain',
  className,
  signed = false,
}: {
  minor: number
  currency: string
  tone?: 'plain' | 'auto' | 'muted'
  className?: string
  signed?: boolean
}) {
  const text = formatMinor(signed ? minor : Math.abs(minor), currency)
  const toneClass =
    tone === 'muted'
      ? 'text-ink-500 dark:text-ink-400'
      : tone === 'auto'
        ? minor < 0
          ? 'text-[var(--color-owes-light)] dark:text-[var(--color-owes-dark)]'
          : minor > 0
            ? 'text-[var(--color-gets-light)] dark:text-[var(--color-gets-dark)]'
            : 'text-ink-500 dark:text-ink-400'
        : ''

  return <span className={cx('tnum', toneClass, className)}>{text}</span>
}

/* -------------------------------------------------------------------------- */
/* Avatar                                                                     */
/* -------------------------------------------------------------------------- */

const AVATAR_COLOURS = [
  'bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-lime-500',
  'bg-emerald-500', 'bg-teal-500', 'bg-cyan-500', 'bg-blue-500',
  'bg-indigo-500', 'bg-violet-500', 'bg-fuchsia-500', 'bg-pink-500',
]

/** Deterministic colour per person, so faces stay recognisable across views. */
function colourFor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length]
}

export function Avatar({
  name,
  id,
  size = 'md',
  className,
}: {
  name: string
  id?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  const sizes = {
    xs: 'size-6 text-[10px]',
    sm: 'size-8 text-xs',
    md: 'size-10 text-sm',
    lg: 'size-14 text-lg',
  }

  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white',
        colourFor(id ?? name),
        sizes[size],
        className,
      )}
      aria-hidden="true"
    >
      {initials || '?'}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Bottom sheet                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Mobile-first modal: slides up from the bottom, reachable with one thumb,
 * dismissable by backdrop tap or Escape. Focus is trapped while open and the
 * page behind it is locked so iOS doesn't scroll it.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'default',
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'default' | 'tall'
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement as HTMLElement | null
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    // Focus the panel itself rather than the first input, so the mobile
    // keyboard doesn't leap up before the user has chosen to type.
    requestAnimationFrame(() => panelRef.current?.focus())

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = overflow
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cx(
          'relative w-full sm:max-w-lg bg-ink-50 dark:bg-ink-950',
          'rounded-t-3xl sm:rounded-3xl shadow-2xl animate-sheet-in outline-none',
          'flex flex-col',
          size === 'tall' ? 'max-h-[92dvh]' : 'max-h-[88dvh]',
        )}
      >
        <div className="shrink-0 px-5 pt-3 pb-3 border-b border-ink-200 dark:border-ink-800">
          <div
            className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink-300 dark:bg-ink-700 sm:hidden"
            aria-hidden="true"
          />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold truncate">{title}</h2>
              {subtitle && (
                <p className="text-sm text-ink-500 dark:text-ink-400 truncate">{subtitle}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="shrink-0 -mr-1 -mt-1 rounded-full p-2 text-ink-500 hover:bg-ink-200 dark:hover:bg-ink-800 pressable"
              aria-label="Close"
            >
              <svg viewBox="0 0 20 20" className="size-5" fill="currentColor">
                <path d="M6.3 5a.9.9 0 00-1.3 1.3L8.7 10l-3.7 3.7A.9.9 0 106.3 15L10 11.3l3.7 3.7a.9.9 0 101.3-1.3L11.3 10l3.7-3.7A.9.9 0 1013.7 5L10 8.7 6.3 5z" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>

        {footer && (
          <div className="shrink-0 border-t border-ink-200 dark:border-ink-800 px-5 py-3 safe-bottom bg-white/80 dark:bg-ink-900/80 backdrop-blur">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* -------------------------------------------------------------------------- */
/* Segmented control                                                          */
/* -------------------------------------------------------------------------- */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string; hint?: string }[]
  className?: string
  ariaLabel?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cx(
        'inline-flex w-full gap-1 rounded-xl bg-ink-100 dark:bg-ink-900 p-1',
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          title={option.hint}
          className={cx(
            'flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition',
            value === option.value
              ? 'bg-white dark:bg-ink-700 text-ink-900 dark:text-white shadow-sm'
              : 'text-ink-500 dark:text-ink-400 active:scale-95',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
      <div className="mb-4 text-5xl" aria-hidden="true">
        {icon}
      </div>
      <h3 className="mb-1.5 text-lg font-bold">{title}</h3>
      <p className="mb-6 max-w-xs text-sm leading-relaxed text-ink-500 dark:text-ink-400">
        {description}
      </p>
      {action}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Status pill                                                                */
/* -------------------------------------------------------------------------- */

export function StatusPill({ status }: { status: 'pending' | 'partial' | 'paid' }) {
  const config = {
    pending: { label: 'Pending', className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
    partial: { label: 'Partly paid', className: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300' },
    paid: { label: 'Paid', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300' },
  }[status]

  return (
    <span className={cx('rounded-full px-2.5 py-1 text-xs font-semibold', config.className)}>
      {config.label}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Confirm dialog                                                             */
/* -------------------------------------------------------------------------- */

export function useConfirm() {
  const [state, setState] = useState<{
    message: string
    confirmLabel: string
    destructive: boolean
    resolve: (ok: boolean) => void
  } | null>(null)

  const confirm = (
    message: string,
    options: { confirmLabel?: string; destructive?: boolean } = {},
  ) =>
    new Promise<boolean>((resolve) => {
      setState({
        message,
        confirmLabel: options.confirmLabel ?? 'Confirm',
        destructive: options.destructive ?? false,
        resolve,
      })
    })

  const dialog = state
    ? createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
          <div
            className="absolute inset-0 bg-ink-950/60 animate-fade-in"
            onClick={() => {
              state.resolve(false)
              setState(null)
            }}
          />
          <div
            role="alertdialog"
            aria-modal="true"
            className="relative w-full max-w-sm rounded-2xl bg-white dark:bg-ink-900 p-5 shadow-2xl animate-fade-in"
          >
            <p className="mb-5 text-[15px] leading-relaxed">{state.message}</p>
            <div className="flex gap-2">
              <button
                className="btn-secondary flex-1"
                onClick={() => {
                  state.resolve(false)
                  setState(null)
                }}
              >
                Cancel
              </button>
              <button
                autoFocus
                className={cx('flex-1', state.destructive ? 'btn-danger' : 'btn-primary')}
                onClick={() => {
                  state.resolve(true)
                  setState(null)
                }}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null

  return { confirm, dialog }
}
