import { useEffect } from 'react'

/**
 * Keep the app's bottom chrome clear of host-injected overlays.
 *
 * Netlify injects an attribution badge (`#nl-badge-frame`) as a fixed iframe
 * pinned to `bottom: 0; right: 0` with a z-index near the 32-bit maximum. It
 * lands directly on top of the right-hand end of our tab bar, covering the
 * "Settle up" and "Summary" tabs.
 *
 * We can't out-stack it, and hiding a provider's attribution is not ours to
 * do — so we move instead: measure whatever is parked against the bottom edge
 * and publish its height as `--bottom-overlay`, which the tab bar, floating
 * button and toast all offset against.
 *
 * Written against *any* bottom-pinned fixed overlay rather than Netlify's id
 * specifically, so the same handling survives a move to another host that
 * injects its own widget.
 */

const SELECTORS = [
  '#nl-badge-frame', // Netlify
  '[id^="vercel-"]', // Vercel toolbar variants
]

/** Ignore anything trivially small or tall enough to be a real page element. */
const MIN_HEIGHT = 16
const MAX_HEIGHT = 120

function measure(): number {
  // The tab bar is `max-w-2xl` and centred, so on a wide window it ends long
  // before the badge's bottom-right corner and nothing is covered. Only shift
  // when the two actually overlap horizontally — otherwise a desktop user
  // loses 64px of height to avoid a collision that never happens.
  const nav = document.querySelector('nav')
  if (!nav) return 0
  const navRect = nav.getBoundingClientRect()

  let tallest = 0

  for (const selector of SELECTORS) {
    for (const node of document.querySelectorAll<HTMLElement>(selector)) {
      const style = getComputedStyle(node)
      if (style.position !== 'fixed' || style.display === 'none') continue

      const rect = node.getBoundingClientRect()
      if (rect.height < MIN_HEIGHT || rect.height > MAX_HEIGHT) continue

      // Only things actually resting on the bottom edge displace our chrome.
      const restsOnBottom = Math.abs(rect.bottom - window.innerHeight) <= 2
      if (!restsOnBottom) continue

      // Horizontal test only. Using the vertical position would be circular —
      // the nav's own offset is what this function decides.
      const overlapsNav = rect.left < navRect.right && rect.right > navRect.left
      if (!overlapsNav) continue

      tallest = Math.max(tallest, rect.height)
    }
  }

  return Math.round(tallest)
}

/**
 * @param ready Re-measure when this flips. The nav only exists once the app
 *   has loaded its data; measuring before that finds nothing to protect, and
 *   the nav then appears inside `#root` where the body observer can't see it.
 */
export function useBottomOverlayInset(ready: boolean): void {
  useEffect(() => {
    const apply = () => {
      document.documentElement.style.setProperty('--bottom-overlay', `${measure()}px`)
    }

    apply()

    // Both halves arrive asynchronously and in either order: the badge is
    // injected by the edge, the nav by React. Watch the body for the badge,
    // and re-check on a short decaying schedule to catch whichever lands last.
    const observer = new MutationObserver(apply)
    observer.observe(document.body, { childList: true, subtree: false })

    const timers = [100, 400, 1000, 2500].map((delay) => setTimeout(apply, delay))

    window.addEventListener('resize', apply)
    window.addEventListener('orientationchange', apply)

    return () => {
      observer.disconnect()
      for (const timer of timers) clearTimeout(timer)
      window.removeEventListener('resize', apply)
      window.removeEventListener('orientationchange', apply)
    }
  }, [ready])
}
