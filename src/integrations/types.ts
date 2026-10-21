import type { SplitType } from '@/domain/types'

/**
 * Phase 2 parser contract — interfaces only in Phase 1.
 *
 * A deliberate note on scope: GPay, PhonePe and Paytm expose no public API for
 * reading a user's personal transactions, so there is no honest way to pull
 * payments automatically. Everything here works on text the user already has —
 * an SMS they paste, a notification a native wrapper forwards with consent, or
 * an email body. That is the feasible surface, and this interface is shaped
 * around it rather than around an integration that cannot be built.
 */

export type MessageChannel = 'sms' | 'notification' | 'email' | 'manual_paste'

export interface RawMessage {
  id: string
  channel: MessageChannel
  /** The message text exactly as received. */
  body: string
  /** Sender id — shortcode, app package name, or email address. */
  sender?: string
  receivedAt: string
}

/** Where a parser got a given field, for showing provenance on the confirm screen. */
export interface FieldProvenance {
  /** Character range in `RawMessage.body` the value came from, if applicable. */
  span?: [number, number]
  /** 0–1. Per-field, because the amount is often certain while the payee is not. */
  confidence: number
}

export interface ParsedExpenseCandidate {
  amountMinor: number | null
  currency?: string
  /** Merchant or counterparty as it appeared in the message. */
  merchant?: string
  date?: string
  /** The free-text payment note, e.g. `"#goa #food @rahul @anu"`. */
  note?: string
  /** Direction: money leaving the user's account vs arriving. */
  direction: 'debit' | 'credit' | 'unknown'
  /** Suggested category id, resolved against the plan's categories. */
  suggestedCategoryId?: string
  /** Person ids resolved from `@mentions` in the note. */
  suggestedPersonIds?: string[]
  suggestedPlanId?: string
  suggestedSplitType?: SplitType
  provenance?: Record<string, FieldProvenance>
}

export interface ParseResult {
  provider: string
  candidate: ParsedExpenseCandidate | null
  /** Overall 0–1 confidence. Controls review guidance; never enables auto-save. */
  confidence: number
  /** Why the parser is unsure, shown to the user on the confirm screen. */
  notes?: string[]
}

/**
 * A pluggable extraction provider.
 *
 * Phase 2 implementations: a local regex/heuristic provider for Indian bank and
 * UPI SMS formats, a tag-convention provider for `#plan #category @person`
 * notes, and an LLM provider that returns the same structured shape. They
 * compose — the registry runs them in priority order and takes the best result.
 */
export interface MessageParser {
  readonly id: string
  readonly label: string
  /** Cheap pre-check so the registry can skip providers that clearly do not apply. */
  canHandle(message: RawMessage): boolean
  parse(message: RawMessage, context: ParseContext): Promise<ParseResult>
}

export interface ParseContext {
  planId?: string
  people: { id: string; name: string; upiId?: string }[]
  categories: { id: string; name: string }[]
  currency: string
}

/**
 * Below this, a parse is never saved without the user editing it first.
 * Above it, the confirm screen is pre-filled and one tap away from saving —
 * but there is *always* a confirm screen. Nothing auto-saves.
 */
export const CONFIDENCE_THRESHOLD = 0.7

/** §3.2 — a proposed match between an incoming payment and a pending balance. */
export interface ReconciliationProposal {
  messageId: string
  fromPersonId: string
  toPersonId: string
  amountMinor: number
  confidence: number
  /** Human-readable justification, e.g. "₹4,000 from anu@okaxis matches Anu's pending ₹4,000". */
  rationale: string
}

export interface ReconciliationEngine {
  readonly id: string
  propose(messages: RawMessage[], context: ReconciliationContext): Promise<ReconciliationProposal[]>
}

export interface ReconciliationContext extends ParseContext {
  pendingObligations: {
    fromPersonId: string
    toPersonId: string
    remainingMinor: number
  }[]
}
