/**
 * Feature flags for Phase 2 work.
 *
 * Everything here is OFF in Phase 1. The flags exist so the Phase 2 surfaces
 * can be merged incrementally behind a switch rather than on a long-lived
 * branch, and so the UI has a single honest place to answer "is this on yet?".
 *
 * Overridable at runtime via `localStorage.setItem('splitr.flags', '{"messageParsing":true}')`
 * for development, so a half-built feature can be exercised without a rebuild.
 */
export interface FeatureFlags {
  /** §3.1 — paste a UPI/bank SMS or email and extract an expense from it. */
  messageParsing: boolean
  /** §3.1 — parse `#goa #food @rahul @anu` note conventions. */
  tagConventions: boolean
  /** §3.1 — LLM-backed extraction provider (needs a server-side proxy). */
  llmParsing: boolean
  /** §3.1 — Android notification/SMS listener via a native wrapper. */
  nativeListeners: boolean
  /** §3.1 — Gmail / bank-alert email ingestion with explicit consent. */
  emailIngestion: boolean
  /** §3.2 — match incoming payment messages against pending balances. */
  paymentReconciliation: boolean
  /** §3.3 — nudge people who have not paid. */
  reminders: boolean
  /** §3.3 — receipt photo OCR. */
  receiptOcr: boolean
  /** §3.3 — multi-currency with a manually entered exchange rate. */
  multiCurrency: boolean
  /** §3.3 — Splitwise CSV import/export compatibility. */
  splitwiseCompat: boolean
}

export const DEFAULT_FLAGS: FeatureFlags = {
  messageParsing: false,
  tagConventions: false,
  llmParsing: false,
  nativeListeners: false,
  emailIngestion: false,
  paymentReconciliation: false,
  reminders: false,
  receiptOcr: false,
  multiCurrency: false,
  splitwiseCompat: false,
}

const STORAGE_KEY = 'splitr.flags'

let cached: FeatureFlags | null = null

export function getFlags(): FeatureFlags {
  if (cached) return cached

  let overrides: Partial<FeatureFlags> = {}
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (raw) overrides = JSON.parse(raw) as Partial<FeatureFlags>
  } catch {
    // A corrupt override must never stop the app booting.
  }

  cached = { ...DEFAULT_FLAGS, ...overrides }
  return cached
}

export function isEnabled(flag: keyof FeatureFlags): boolean {
  return getFlags()[flag]
}

export function setFlag(flag: keyof FeatureFlags, value: boolean): void {
  const next = { ...getFlags(), [flag]: value }
  cached = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Non-fatal: the flag still applies for this session.
  }
}

/** Test seam. */
export function resetFlags(): void {
  cached = null
}
