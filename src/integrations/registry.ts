import { localMessageParser } from './localParser'
import { isEnabled } from './flags'
import { CONFIDENCE_THRESHOLD, type MessageParser, type ParseContext, type ParseResult, type RawMessage } from './types'

/** Providers return review candidates only. The local provider works offline. */
const parsers: MessageParser[] = [localMessageParser]

export function registerParser(parser: MessageParser): void {
  if (parsers.some((p) => p.id === parser.id)) {
    throw new Error(`A parser with id "${parser.id}" is already registered`)
  }
  parsers.push(parser)
}

export function listParsers(): readonly MessageParser[] {
  return parsers
}

/** Test seam. */
export function clearParsers(): void {
  parsers.length = 0
}

const EMPTY_RESULT: ParseResult = {
  provider: 'none',
  candidate: null,
  confidence: 0,
  notes: ['No message parser is available.'],
}

/**
 * Run every applicable parser and return the most confident result.
 *
 * Providers are run concurrently and a thrown provider is treated as a
 * zero-confidence result rather than failing the whole parse — one broken
 * regex should not take down the paste box.
 */
export async function parseMessage(
  message: RawMessage,
  context: ParseContext,
): Promise<ParseResult> {
  if (!isEnabled('messageParsing')) return EMPTY_RESULT

  const applicable = parsers.filter((p) => {
    try {
      return p.canHandle(message)
    } catch {
      return false
    }
  })

  if (applicable.length === 0) return EMPTY_RESULT

  const results = await Promise.all(
    applicable.map(async (parser): Promise<ParseResult> => {
      try {
        return await parser.parse(message, context)
      } catch (error) {
        return {
          provider: parser.id,
          candidate: null,
          confidence: 0,
          notes: [`${parser.label} failed: ${(error as Error).message}`],
        }
      }
    }),
  )

  return results.reduce((best, current) => (current.confidence > best.confidence ? current : best))
}

/**
 * Whether a parse is good enough to pre-fill the confirm screen.
 * Never "good enough to save without asking" — that screen is mandatory.
 */
export function isHighConfidence(result: ParseResult): boolean {
  return result.candidate !== null && result.confidence >= CONFIDENCE_THRESHOLD
}
