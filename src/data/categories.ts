import type { Category } from '@/domain/types'
import { newId } from '@/lib/id'

/** The starting set. Users can add, rename or hide any of these per plan. */
export const DEFAULT_CATEGORIES: { key: string; name: string; icon: string }[] = [
  { key: 'food', name: 'Food', icon: '🍽️' },
  { key: 'movie', name: 'Movie', icon: '🎬' },
  { key: 'shopping', name: 'Shopping', icon: '🛍️' },
  { key: 'travel', name: 'Travel', icon: '🚕' },
  { key: 'stay', name: 'Stay', icon: '🏨' },
  { key: 'fuel', name: 'Fuel', icon: '⛽' },
  { key: 'tickets', name: 'Tickets', icon: '🎟️' },
  { key: 'misc', name: 'Misc', icon: '📦' },
]

export const CATEGORY_ICONS = [
  '🍽️', '🎬', '🛍️', '🚕', '🏨', '⛽', '🎟️', '📦',
  '☕', '🍺', '🏖️', '🎳', '🚌', '✈️', '🛒', '💊',
  '🎁', '🧾', '🏧', '🅿️',
]

export function createDefaultCategories(planId: string): Category[] {
  return DEFAULT_CATEGORIES.map(({ name, icon }) => ({
    id: newId('cat'),
    planId,
    name,
    icon,
    hidden: false,
  }))
}
