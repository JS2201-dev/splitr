import { computeBalances, expenseLinesForPerson } from './balances'
import { currencyExponent, formatMinor } from './money'
import type { Expense, Payment, Person } from './types'

export interface PersonSummary {
  person: Person
  paidMinor: number
  shareMinor: number
  netMinor: number
  /** The sentence shown at the top of a person's card. */
  headline: string
  /** Itemised contributions to their share, largest first. */
  lines: { name: string; shareMinor: number }[]
  /** Full plain-English sentence, e.g. "You owe ₹1,240: Dinner ₹600, Cab ₹400". */
  breakdown: string
}

/**
 * Build the plain-English per-person explanation.
 *
 * The point is that someone looking at "you owe ₹1,240" can see exactly which
 * expenses produced that number without opening anything.
 */
export function summarisePerson(
  person: Person,
  expenses: Expense[],
  payments: Payment[],
  people: Person[],
  currency: string,
  locale = 'en-IN',
): PersonSummary {
  const sheet = computeBalances(people, expenses, payments)
  const row = sheet.get(person.id)
  const paidMinor = row?.paidMinor ?? 0
  const shareMinor = row?.shareMinor ?? 0
  const netMinor = row?.netMinor ?? 0

  const lines = expenseLinesForPerson(person.id, expenses)
    .filter((l) => l.shareMinor !== 0)
    .map((l) => ({ name: l.name, shareMinor: l.shareMinor }))
    .sort((a, b) => Math.abs(b.shareMinor) - Math.abs(a.shareMinor))

  const money = (minor: number) => formatMinor(minor, currency, locale)

  let headline: string
  if (netMinor === 0) headline = 'All square'
  else if (netMinor > 0) headline = `Gets back ${money(netMinor)}`
  else headline = `Owes ${money(-netMinor)}`

  const itemised = lines.map((l) => `${l.name} ${money(l.shareMinor)}`).join(', ')
  const breakdown =
    lines.length === 0
      ? `${person.name} has no shared expenses yet.`
      : `${person.name}'s share is ${money(shareMinor)}: ${itemised}. ` +
        `They paid ${money(paidMinor)}, so ${
          netMinor === 0
            ? 'they are all square.'
            : netMinor > 0
              ? `they get back ${money(netMinor)}.`
              : `they owe ${money(-netMinor)}.`
        }`

  return { person, paidMinor, shareMinor, netMinor, headline, lines, breakdown }
}

export function summariseAll(
  people: Person[],
  expenses: Expense[],
  payments: Payment[],
  currency: string,
  locale = 'en-IN',
): PersonSummary[] {
  return people
    .map((p) => summarisePerson(p, expenses, payments, people, currency, locale))
    .sort((a, b) => a.netMinor - b.netMinor)
}

/**
 * Build a `upi://pay` deep link.
 *
 * This is the one piece of UPI integration that genuinely works without a
 * partner agreement: it is a client-side intent URL that opens the user's
 * installed UPI app with the payee, amount and note pre-filled. It cannot
 * confirm that a payment happened — that still needs a manual "record payment"
 * or, in Phase 2, a parsed confirmation message.
 */
export function buildUpiLink(params: {
  payeeUpiId: string
  payeeName: string
  amountMinor: number
  currency: string
  note?: string
}): string {
  const { payeeUpiId, payeeName, amountMinor, currency, note } = params
  const exponent = currencyExponent(currency)
  const amount = (Math.abs(amountMinor) / 10 ** exponent).toFixed(exponent)
  const query = new URLSearchParams({
    pa: payeeUpiId,
    pn: payeeName,
    am: amount,
    cu: currency.toUpperCase(),
  })
  if (note) query.set('tn', note.slice(0, 50))
  return `upi://pay?${query.toString()}`
}
