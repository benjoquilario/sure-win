/**
 * ─── Responsive layout tokens ─────────────────────────────────────────────
 *
 * The app runs on a 320pt Android Go phone, a 430pt Pro Max, a 1024pt iPad
 * and a desktop browser. Before this file every screen assumed a phone: cards
 * stretched edge to edge across a tablet, and a paragraph of question text ran
 * 1,200px wide on the web, which nobody can read.
 *
 * Three window classes, the same cut points Material 3 uses, so the behaviour
 * matches what Android users already get from their system apps:
 *
 *   compact   < 600   phones in portrait                 bottom bar
 *   medium    < 1024  large phones in landscape, tablets bottom bar, 2 columns
 *   expanded  ≥ 1024  tablets in landscape, desktop web  side navigation
 *
 * Content never grows past a readable measure. On a wide screen the extra
 * space becomes margin, not longer lines.
 */

export type WindowClass = "compact" | "medium" | "expanded"

export const BREAKPOINTS = {
  medium: 600,
  expanded: 1024,
  /** The side rail gains labels beside its icons from here. */
  wide: 1280,
} as const

/** Below this the gutter tightens, so a 320pt phone keeps usable card width. */
export const SMALL_PHONE_WIDTH = 360

/**
 * How wide content may get.
 *
 *   reading   question text, lessons, forms - about 75 characters a line
 *   standard  lists of cards, dashboards
 *   wide      multi-column grids
 */
export const CONTENT_MAX_WIDTH = {
  reading: 720,
  standard: 960,
  wide: 1200,
} as const

export type ContentWidth = keyof typeof CONTENT_MAX_WIDTH

/** Side navigation widths. The bottom bar takes no horizontal space. */
export const NAV_RAIL_WIDTH = 96
export const NAV_SIDEBAR_WIDTH = 248

export function getWindowClass(width: number): WindowClass {
  if (width >= BREAKPOINTS.expanded) {
    return "expanded"
  }

  if (width >= BREAKPOINTS.medium) {
    return "medium"
  }

  return "compact"
}

/** Horizontal breathing room between the screen edge and content. */
export function getGutter(width: number): number {
  if (width < SMALL_PHONE_WIDTH) {
    return 12
  }

  if (width < BREAKPOINTS.medium) {
    return 16
  }

  if (width < BREAKPOINTS.expanded) {
    return 24
  }

  return 32
}

/**
 * The side navigation for a window, or null for the bottom bar.
 *
 * Measured against the whole window, because it decides how much of the
 * window the content gets.
 */
export function getSideNavWidth(windowWidth: number): number {
  if (windowWidth >= BREAKPOINTS.wide) {
    return NAV_SIDEBAR_WIDTH
  }

  if (windowWidth >= BREAKPOINTS.expanded) {
    return NAV_RAIL_WIDTH
  }

  return 0
}

/**
 * Horizontal padding that centres content at `maxWidth` inside `frameWidth`,
 * and never drops below the gutter.
 *
 * Returned as padding rather than a max-width wrapper because FlashList and
 * ScrollView only accept padding in `contentContainerStyle` - a wrapper would
 * have to sit inside every row.
 */
export function getCenteredPadding(
  frameWidth: number,
  maxWidth: number
): number {
  const gutter = getGutter(frameWidth)
  const inner = Math.min(frameWidth - gutter * 2, maxWidth)

  return Math.max(gutter, Math.floor((frameWidth - inner) / 2))
}

/**
 * How many columns of cards fit, given the narrowest a card may get.
 * Capped so a 4K monitor does not produce a row of eight slivers.
 */
export function getColumnCount(
  contentWidth: number,
  minColumnWidth: number,
  maxColumns = 3
): number {
  return Math.max(
    1,
    Math.min(maxColumns, Math.floor(contentWidth / minColumnWidth))
  )
}

/**
 * Spacing for one cell of a FlashList grid.
 *
 * FlashList sizes each column equally and has no column gap, so the gap is
 * split into the facing sides of neighbouring cells. Edge cells keep a flush
 * outer side, which keeps the grid aligned with a header above it.
 */
export function getGridCellStyle(index: number, columns: number, gap = 12) {
  if (columns <= 1) {
    return { flex: 1 }
  }

  const column = index % columns

  return {
    flex: 1,
    paddingLeft: column === 0 ? 0 : gap / 2,
    paddingRight: column === columns - 1 ? 0 : gap / 2,
  }
}
