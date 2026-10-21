import { parseAmountToMinor } from '@/domain/money'
import { suggestCategory } from '@/lib/quickAdd'
import type { Category } from '@/domain/types'
import type { MessageParser, ParseContext, ParseResult, RawMessage } from './types'
import { isEnabled } from './flags'

function extractDate(text: string): string | undefined {
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text)
  const indian = /\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/.exec(text)
  const named = /\b(\d{1,2})[- ](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[- ](20\d{2})\b/i.exec(text)
  const date = iso ? iso[0] : indian ? `${indian[3]}-${indian[2].padStart(2, '0')}-${indian[1].padStart(2, '0')}` : named ? `${named[3]}-${String(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(named[2].toLowerCase()) + 1).padStart(2, '0')}-${named[1].padStart(2, '0')}` : undefined
  return date && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : undefined
}

export function parseLocalMessage(message: RawMessage, context: ParseContext): ParseResult {
  const text = message.body
  // Available balance, OTPs, account digits and reference numbers are never amount candidates.
  const transaction = text.split(/(?:avl\.?|available|closing|remaining)\s*(?:bal(?:ance)?)/i)[0]
  const amounts = [...transaction.matchAll(/(?:₹|\bINR\.?|\bRs\.?)\s*([\d,]+(?:\.\d{1,2})?)(?![\d.])/gi)]
    .map((m) => parseAmountToMinor(m[1].replace(/,/g, ''), context.currency))
    .filter((v): v is number => v !== null && v > 0)
  const uniqueAmounts = [...new Set(amounts)]
  const amountMinor = uniqueAmounts.length === 1 && context.currency.toUpperCase() === 'INR' ? uniqueAmounts[0] : null
  const credit = /\b(credited|received|deposited)\b/i.test(transaction)
  const debit = /\b(debited|paid|spent|sent|purchase)\b/i.test(transaction)
  const direction = credit && !debit ? 'credit' : debit && !credit ? 'debit' : 'unknown'
  const merchantMatch = /\b(?:to|at|from)\s+([\p{L}\p{N}][\p{L}\p{N} ._@&-]*?)(?=\s+(?:on|via|using|UPI|ref|UTR|a\/c|ac|for|with|has|is)\b|[;\n,#]|$)/iu.exec(transaction)
  const merchant = merchantMatch?.[1].trim().replace(/[.]+$/, '')
  const categories = context.categories as Category[]
  const tags = isEnabled('tagConventions') ? [...text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1].toLowerCase()) : []
  const taggedCategories = categories.filter((c) => !c.hidden && tags.includes(c.name.toLowerCase().replace(/\s+/g, '_')))
  // Whitespace-bound @mentions exclude UPI addresses such as anu@okaxis.
  const mentions = isEnabled('tagConventions') ? [...text.matchAll(/(?:^|\s)@([\p{L}\p{N}_-]+)/gu)].map((m) => m[1].toLowerCase()) : []
  const suggestedPersonIds: string[] = []
  const notes: string[] = []
  for (const mention of mentions) {
    const matches = context.people.filter((p) => p.name.toLowerCase().replace(/\s+/g, '_') === mention || p.name.split(' ')[0].toLowerCase() === mention)
    if (matches.length === 1) suggestedPersonIds.push(matches[0].id)
    else notes.push(`@${mention} ${matches.length ? 'matches several people' : 'is not in this plan'}; select participants during review.`)
  }
  const date = extractDate(text)
  if (!amountMinor) notes.push(uniqueAmounts.length > 1 ? 'Several amounts found. Enter the transaction amount during review.' : 'No reliable INR transaction amount found. Enter it during review.')
  if (!date) notes.push('No reliable date found. Review the date before saving.')
  if (!merchant) notes.push('Merchant or sender is unclear. Enter a name during review.')
  if (direction === 'unknown') notes.push('Payment direction is unclear. Confirm whether this is spending or a repayment.')
  if (taggedCategories.length > 1) notes.push('Several category tags found. Choose a category during review.')
  return {
    provider: 'local',
    candidate: { amountMinor, currency: context.currency, merchant, date, note: text, direction,
      suggestedCategoryId: taggedCategories.length === 1 ? taggedCategories[0].id : taggedCategories.length === 0 ? suggestCategory(merchant ?? text, categories) : undefined,
      suggestedPersonIds: [...new Set(suggestedPersonIds)], suggestedPlanId: context.planId,
    },
    confidence: amountMinor ? (merchant && date && direction !== 'unknown' && notes.length === 0 ? 0.9 : 0.6) : 0.2,
    notes,
  }
}

export const localMessageParser: MessageParser = {
  id: 'local', label: 'On-device message parser', canHandle: (message) => Boolean(message.body.trim()),
  parse: async (message, context) => parseLocalMessage(message, context),
}
