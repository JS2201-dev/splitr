import type { StorageAdapter } from './adapter'
import { IndexedDbAdapter } from './indexeddb'
import { MemoryAdapter } from './memory'

export type { StorageAdapter } from './adapter'
export { IndexedDbAdapter } from './indexeddb'
export { MemoryAdapter } from './memory'

let adapter: StorageAdapter | null = null
let degraded = false

/** True when we fell back to memory and nothing will survive a refresh. */
export function isStorageDegraded(): boolean {
  return degraded
}

/**
 * Resolve the storage adapter for this session.
 *
 * Phase 2 swaps the body of this function — a `SupabaseAdapter` chosen by a
 * feature flag or the presence of a signed-in session — and nothing else in the
 * app has to change.
 */
export async function getStorage(): Promise<StorageAdapter> {
  if (adapter) return adapter

  const candidate: StorageAdapter =
    typeof indexedDB !== 'undefined' ? new IndexedDbAdapter() : new MemoryAdapter()

  try {
    await candidate.init()
    adapter = candidate
  } catch (error) {
    console.warn('IndexedDB unavailable, falling back to in-memory storage', error)
    const fallback = new MemoryAdapter()
    await fallback.init()
    adapter = fallback
    degraded = true
  }

  return adapter
}

/** Test seam: force a specific adapter. */
export function setStorage(next: StorageAdapter | null): void {
  adapter = next
  degraded = next?.name === 'memory'
}
