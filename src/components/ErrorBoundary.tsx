import { Component, type ErrorInfo, type ReactNode } from 'react'
import { getStorage } from '@/storage'
import { buildBackup } from '@/export/backup'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  rescuing: boolean
  rescued: 'idle' | 'done' | 'failed'
}

/**
 * Catches render crashes.
 *
 * Without this, a bug anywhere in the tree gives a blank white page with the
 * user's expenses still sitting in IndexedDB and no way to get them out. The
 * important part of this screen is not the apology — it is the "download my
 * data" button, which reads straight from storage and bypasses the broken
 * React tree entirely.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, rescuing: false, rescued: 'idle' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Splitr crashed:', error, info.componentStack)
  }

  /**
   * Export every plan directly from storage. Deliberately does not touch the
   * Zustand store or any component state — whatever broke the UI may well be
   * in there.
   */
  private rescue = async () => {
    this.setState({ rescuing: true, rescued: 'idle' })
    try {
      const storage = await getStorage()
      const plans = await storage.listPlans()
      const bundles = []
      for (const plan of plans) {
        const bundle = await storage.loadBundle(plan.id)
        if (bundle) bundles.push(buildBackup(bundle))
      }

      const blob = new Blob([JSON.stringify(bundles, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `splitr-rescue-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)

      this.setState({ rescuing: false, rescued: 'done' })
    } catch (error) {
      console.error('Rescue export failed', error)
      this.setState({ rescuing: false, rescued: 'failed' })
    }
  }

  render() {
    const { error, rescuing, rescued } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="w-full max-w-sm text-center">
          <div className="mb-4 text-5xl" aria-hidden="true">
            😵
          </div>
          <h1 className="mb-2 text-xl font-bold">Something broke</h1>
          <p className="mb-6 text-sm leading-relaxed text-ink-500 dark:text-ink-400">
            Splitr hit a bug and couldn't finish loading. Your expenses are still saved on this
            device — download a copy before doing anything else.
          </p>

          <div className="space-y-2">
            <button onClick={this.rescue} disabled={rescuing} className="btn-primary w-full">
              {rescuing ? 'Exporting…' : 'Download my data'}
            </button>
            <button onClick={() => window.location.reload()} className="btn-secondary w-full">
              Reload the app
            </button>
          </div>

          {rescued === 'done' && (
            <p className="mt-3 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              Saved. You can restore it from Menu → Backup &amp; restore.
            </p>
          )}
          {rescued === 'failed' && (
            <p className="mt-3 text-sm font-medium text-rose-600 dark:text-rose-400">
              Couldn't export — your data is still on the device, but don't clear site data.
            </p>
          )}

          <details className="mt-6 text-left">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-ink-400">
              Technical details
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-ink-100 p-3 text-[11px] leading-relaxed dark:bg-ink-900">
              {error.message}
              {error.stack ? `\n\n${error.stack.split('\n').slice(0, 6).join('\n')}` : ''}
            </pre>
          </details>
        </div>
      </div>
    )
  }
}
