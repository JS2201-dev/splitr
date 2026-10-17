import { parseAmountToMinor } from '@/domain/money'
import type { Category, Person } from '@/domain/types'

/**
 * Quick-add parser for the fast-entry box (§2.3).
 *
 * Format: `Name | Amount | Paid by | People involved`
 *   "Dinner | 2400 | Rahul | Rahul, Anu, Vikram"
 *
 * Trailing fields are optional and degrade sensibly:
 *   "Dinner | 2400"                 → payer and split left for the form
 *   "Dinner | 2400 | Rahul"         → everyone splits it
 *   "Dinner | 2400 | Rahul | all"   → same, explicitly
 *
 * Name matching is fuzzy on purpose — people type "rahul", "Rahul", or "rah"
 * and all three should land. Anything ambiguous is reported rather than
 * guessed, because a wrong payer silently corrupts the whole balance sheet.
 */

export interface QuickAddResult {
  line: string
  name: string
  amountMinor: number | null
  payerId?: string
  involvedIds: string[]
  categoryId?: string
  /** Blocking problems — the row cannot be turned into an expense. */
  errors: string[]
  /** Non-blocking notes, e.g. "assumed everyone is involved". */
  warnings: string[]
}

const ALL_TOKENS = new Set(['all', 'everyone', 'everybody', '*'])

function normalise(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Resolve a typed name to a person.
 * Exact match wins; then unique prefix; then unique substring.
 */
function resolvePerson(
  token: string,
  people: Person[],
): { person?: Person; error?: string } {
  const needle = normalise(token)
  if (!needle) return {}

  const exact = people.filter((p) => normalise(p.name) === needle)
  if (exact.length === 1) return { person: exact[0] }
  if (exact.length > 1) return { error: `"${token}" matches more than one person` }

  const prefix = people.filter((p) => normalise(p.name).startsWith(needle))
  if (prefix.length === 1) return { person: prefix[0] }
  if (prefix.length > 1) {
    return { error: `"${token}" is ambiguous (${prefix.map((p) => p.name).join(', ')})` }
  }

  const substring = people.filter((p) => normalise(p.name).includes(needle))
  if (substring.length === 1) return { person: substring[0] }
  if (substring.length > 1) {
    return { error: `"${token}" is ambiguous (${substring.map((p) => p.name).join(', ')})` }
  }

  return { error: `No one called "${token}" in this plan` }
}

/**
 * Resolve the "people involved" field, supporting `all` and `all except X, Y`.
 */
function resolveInvolved(
  token: string,
  people: Person[],
): { ids: string[]; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const trimmed = token.trim()
  const splittable = people.filter((p) => p.role === 'attendee')

  if (!trimmed || ALL_TOKENS.has(normalise(trimmed))) {
    return { ids: splittable.map((p) => p.id), errors, warnings }
  }

  const exceptMatch = /^(?:all\s+)?(?:except|but|minus|other than)\s+(.+)$/i.exec(trimmed)
  if (exceptMatch) {
    const excludedIds = new Set<string>()
    for (const name of exceptMatch[1].split(/[,&]|\band\b/i)) {
      if (!name.trim()) continue
      const { person, error } = resolvePerson(name, people)
      if (error) errors.push(error)
      else if (person) excludedIds.add(person.id)
    }
    const ids = splittable.filter((p) => !excludedIds.has(p.id)).map((p) => p.id)
    if (ids.length === 0) errors.push('That excludes everyone — no one is left in the split')
    return { ids, errors, warnings }
  }

  const ids: string[] = []
  for (const name of trimmed.split(/[,&]|\band\b/i)) {
    if (!name.trim()) continue
    const { person, error } = resolvePerson(name, people)
    if (error) errors.push(error)
    else if (person && !ids.includes(person.id)) ids.push(person.id)
  }

  if (ids.length === 0 && errors.length === 0) {
    errors.push('No one was matched in the split')
  }

  return { ids, errors, warnings }
}

/** Guess a category from the expense name, so the common cases need no tapping. */
const CATEGORY_HINTS: { pattern: RegExp; category: string }[] = [
  { pattern: /\b(dinner|lunch|breakfast|brunch|food|snack|cafe|coffee|restaurant|swiggy|zomato|pizza|biryani)\b/i, category: 'food' },
  { pattern: /\b(movie|cinema|pvr|inox|bookmyshow|imax)\b/i, category: 'movie' },
  { pattern: /\b(cab|uber|ola|taxi|auto|train|irctc|flight|bus|rapido|metro)\b/i, category: 'travel' },
  { pattern: /\b(hotel|stay|villa|airbnb|resort|hostel|oyo|room)\b/i, category: 'stay' },
  { pattern: /\b(petrol|diesel|fuel|gas|hp|ioc|bharat petroleum)\b/i, category: 'fuel' },
  { pattern: /\b(ticket|entry|pass|park|museum)\b/i, category: 'tickets' },
  { pattern: /\b(shopping|grocery|groceries|mart|store|amazon|flipkart|bigbasket|blinkit|zepto)\b/i, category: 'shopping' },
]

export function suggestCategory(name: string, categories: Category[]): string | undefined {
  for (const { pattern, category } of CATEGORY_HINTS) {
    if (!pattern.test(name)) continue
    const match = categories.find((c) => !c.hidden && normalise(c.name) === category)
    if (match) return match.id
  }
  return undefined
}

/** Parse one line. */
export function parseQuickAddLine(
  line: string,
  people: Person[],
  categories: Category[],
  currency: string,
): QuickAddResult {
  const errors: string[] = []
  const warnings: string[] = []
  const parts = line.split('|').map((p) => p.trim())

  const name = parts[0] ?? ''
  if (!name) errors.push('Missing expense name')

  const amountMinor = parts[1] ? parseAmountToMinor(parts[1], currency) : null
  if (!parts[1]) errors.push('Missing amount')
  else if (amountMinor === null) errors.push(`"${parts[1]}" is not a valid amount`)
  else if (amountMinor === 0) errors.push('Amount must not be zero')

  let payerId: string | undefined
  if (parts[2]) {
    const { person, error } = resolvePerson(parts[2], people)
    if (error) errors.push(error)
    else payerId = person?.id
  } else {
    warnings.push('No payer given — pick one before saving')
  }

  let involvedIds: string[] = []
  if (parts.length > 3) {
    const resolved = resolveInvolved(parts.slice(3).join('|'), people)
    involvedIds = resolved.ids
    errors.push(...resolved.errors)
    warnings.push(...resolved.warnings)
  } else {
    involvedIds = people.filter((p) => p.role === 'attendee').map((p) => p.id)
    warnings.push('Split across everyone')
  }

  return {
    line,
    name,
    amountMinor,
    payerId,
    involvedIds,
    categoryId: suggestCategory(name, categories),
    errors,
    warnings,
  }
}

/** Parse a whole pasted block, one expense per non-empty line. */
export function parseQuickAdd(
  text: string,
  people: Person[],
  categories: Category[],
  currency: string,
): QuickAddResult[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseQuickAddLine(line, people, categories, currency))
}
