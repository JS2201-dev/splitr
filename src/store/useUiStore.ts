import { create } from 'zustand'

export type TabKey = 'expenses' | 'balances' | 'settle' | 'summary'
export type ThemeMode = 'light' | 'dark' | 'system'

interface UiState {
  tab: TabKey
  theme: ThemeMode
  toast: { id: number; message: string; actionLabel?: string; action?: () => void } | null

  setTab: (tab: TabKey) => void
  setTheme: (theme: ThemeMode) => void
  showToast: (message: string, options?: { actionLabel?: string; action?: () => void }) => void
  dismissToast: () => void
}

const THEME_KEY = 'splitr.theme'

function readTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Fall through to the default.
  }
  return 'system'
}

/** Apply the theme to the document root, respecting the OS when set to `system`. */
export function applyTheme(theme: ThemeMode): void {
  const prefersDark =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = theme === 'dark' || (theme === 'system' && prefersDark)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

let toastSeq = 0

export const useUiStore = create<UiState>((set) => ({
  tab: 'expenses',
  theme: readTheme(),
  toast: null,

  setTab: (tab) => set({ tab }),

  setTheme: (theme) => {
    set({ theme })
    applyTheme(theme)
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // Theme just won't persist; not worth interrupting the user over.
    }
  },

  showToast: (message, options) =>
    set({ toast: { id: ++toastSeq, message, ...options } }),

  dismissToast: () => set({ toast: null }),
}))
