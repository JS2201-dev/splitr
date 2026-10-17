/**
 * The settlement engine.
 *
 * Everything exported here is a pure function over plain data — no storage, no
 * React, no side effects. That is what makes the money logic testable in
 * isolation and safe to reuse from a future server.
 */

export * from './types'
export * from './money'
export * from './split'
export * from './balances'
export * from './settlement'
export * from './summary'
export * from './validation'
