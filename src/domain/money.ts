/**
 * Money is always an integer count of minor units.
 *
 * `0.1 + 0.2 !== 0.3` in IEEE-754, and a split-the-bill app that drifts by a
 * paise per expense will not balance to zero after fifty expenses. So amounts
 * are parsed to integers at the edge, every calculation is integer arithmetic,
 * and formatting back to a decimal string happens only for display.
 */

/** Minor units per major unit, by ISO 4217 code. Default is 2 decimal places. */
const EXPONENTS: Record<string, number> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  AED: 2,
  SGD: 2,
  AUD: 2,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
}

export function currencyExponent(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2
}

export function minorPerMajor(currency: string): number {
  return 10 ** currencyExponent(currency)
}

/**
 * Parse user input ("1,234.50", "₹1234.5", "-200") into minor units.
 * Returns `null` for anything that isn't a well-formed amount, so callers can
 * distinguish "empty/invalid" from "legitimately zero".
 */
export function parseAmountToMinor(input: string | number, currency: string): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null
    return Math.round(input * minorPerMajor(currency))
  }

  // Strip currency symbols, spaces and thousands separators.
  const cleaned = input.trim().replace(/[₹$€£,\s]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null

  const exponent = currencyExponent(currency)
  const negative = cleaned.startsWith('-')
  const unsigned = negative ? cleaned.slice(1) : cleaned
  const [whole = '', fraction = ''] = unsigned.split('.')
  if (fraction.length > exponent) {
    // More precision than the currency supports — round half-up rather than
    // silently truncating a value the user typed.
    const scaled = Number(`${whole || '0'}.${fraction}`) * 10 ** exponent
    if (!Number.isFinite(scaled)) return null
    const rounded = Math.round(scaled)
    return negative ? -rounded : rounded
  }

  const paddedFraction = fraction.padEnd(exponent, '0')
  const minor = Number(`${whole || '0'}${paddedFraction}`)
  if (!Number.isFinite(minor)) return null
  return negative ? -minor : minor
}

/** Render minor units as a plain decimal string, no symbol. `123450` → `"1234.50"`. */
export function minorToDecimalString(minor: number, currency: string): string {
  const exponent = currencyExponent(currency)
  const negative = minor < 0
  const abs = Math.abs(Math.trunc(minor)).toString().padStart(exponent + 1, '0')
  const whole = abs.slice(0, abs.length - exponent) || '0'
  const fraction = exponent > 0 ? `.${abs.slice(abs.length - exponent)}` : ''
  return `${negative ? '-' : ''}${whole}${fraction}`
}

const formatterCache = new Map<string, Intl.NumberFormat>()

function formatterFor(currency: string, locale: string): Intl.NumberFormat {
  const key = `${locale}:${currency}`
  let formatter = formatterCache.get(key)
  if (!formatter) {
    const exponent = currencyExponent(currency)
    try {
      formatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: exponent,
        maximumFractionDigits: exponent,
      })
    } catch {
      // Unknown currency code — fall back to plain decimal grouping.
      formatter = new Intl.NumberFormat(locale, {
        minimumFractionDigits: exponent,
        maximumFractionDigits: exponent,
      })
    }
    formatterCache.set(key, formatter)
  }
  return formatter
}

/** Display-formatted money, e.g. `"₹1,234.50"`. */
export function formatMinor(minor: number, currency: string, locale = 'en-IN'): string {
  const value = Math.trunc(minor) / minorPerMajor(currency)
  return formatterFor(currency, locale).format(value)
}

/** Just the symbol, for compact UI like input prefixes. */
export function currencySymbol(currency: string, locale = 'en-IN'): string {
  const parts = formatterFor(currency, locale).formatToParts(0)
  return parts.find((p) => p.type === 'currency')?.value ?? currency
}

export function sumMinor(values: number[]): number {
  let total = 0
  for (const value of values) total += value
  return total
}

/**
 * Split `total` across `weights` so the parts sum to *exactly* `total`.
 *
 * Uses the largest-remainder (Hamilton) method: floor every share, then hand
 * the leftover minor units out one at a time to the entries with the largest
 * discarded fraction. Ties break on the caller-supplied `tieBreakKeys` so the
 * result is stable across runs and across machines — ₹100 between 3 people is
 * always 33.34 / 33.33 / 33.33 against the same person, never a reshuffle on
 * reload.
 *
 * Negative totals (refunds) are allocated by magnitude and re-signed, so a
 * -₹100 refund splits as -33.34 / -33.33 / -33.33 and still sums exactly.
 */
export function allocate(total: number, weights: number[], tieBreakKeys?: string[]): number[] {
  const count = weights.length
  if (count === 0) {
    if (total !== 0) throw new Error('Cannot allocate a non-zero amount across zero participants')
    return []
  }
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new Error('Weights must be finite and non-negative')
  }

  const weightTotal = weights.reduce((a, b) => a + b, 0)
  if (weightTotal <= 0) {
    if (total !== 0) throw new Error('Cannot allocate a non-zero amount across zero total weight')
    return new Array(count).fill(0)
  }

  const sign = total < 0 ? -1 : 1
  const magnitude = Math.abs(Math.trunc(total))

  const base: number[] = new Array(count)
  const remainders: { index: number; fraction: number; key: string }[] = new Array(count)

  let distributed = 0
  for (let i = 0; i < count; i++) {
    const exact = (magnitude * weights[i]) / weightTotal
    const floored = Math.floor(exact)
    base[i] = floored
    distributed += floored
    remainders[i] = {
      index: i,
      fraction: exact - floored,
      key: tieBreakKeys?.[i] ?? String(i).padStart(8, '0'),
    }
  }

  let leftover = magnitude - distributed

  // Largest fraction first; ties go to the lexicographically smaller key.
  remainders.sort((a, b) => {
    if (b.fraction !== a.fraction) return b.fraction - a.fraction
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })

  for (let i = 0; i < remainders.length && leftover > 0; i++) {
    base[remainders[i].index] += 1
    leftover -= 1
  }

  return sign === 1 ? base : base.map((v) => -v)
}
