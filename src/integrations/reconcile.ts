import type { PlanBundle } from '@/domain/types'
import { buildSettlement, type Obligation } from '@/domain/settlement'
import type { ParsedExpenseCandidate } from './types'
import { isEnabled } from './flags'

/** Amount alone is insufficient: require an unambiguous sender identity as well. */
export function matchIncomingPayment(candidate: ParsedExpenseCandidate, bundle: PlanBundle): Obligation[] {
  if (!isEnabled('paymentReconciliation') || candidate.direction !== 'credit' || !candidate.amountMinor || !candidate.merchant) return []
  const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}@]/gu, '')
  const sender = normalize(candidate.merchant)
  const people = bundle.people.filter((p) => normalize(p.name) === sender || (p.upiId && normalize(p.upiId) === sender))
  if (people.length !== 1) return []
  const { plan, expenses, payments } = bundle
  return buildSettlement(bundle.people, expenses, payments, plan.settlementMode, plan.organizerId).obligations.filter((o) =>
    o.fromPersonId === people[0].id && o.remainingMinor >= candidate.amountMinor! && o.remainingMinor > 0,
  )
}
