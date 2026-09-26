import { createContext, useContext, useMemo } from "react"
import { useWindowDimensions } from "react-native"

import {
  CONTENT_MAX_WIDTH,
  getCenteredPadding,
  getColumnCount,
  getGutter,
  getSideNavWidth,
  getWindowClass,
  SMALL_PHONE_WIDTH,
  type ContentWidth,
} from "@/lib/layout"

/**
 * How much of the window the side navigation occupies around the current
 * screen.
 *
 * Provided by the tab layout, so a tab screen measures itself against the
 * space beside the rail. Screens pushed on the root stack cover the rail and
 * see the default of 0 - they get the full window, which is correct.
 */
export const SideNavInsetContext = createContext(0)

export function useSideNavWidth() {
  const { width } = useWindowDimensions()
  return getSideNavWidth(width)
}

export function useLayout() {
  const { width, height, fontScale } = useWindowDimensions()
  const sideNavInset = useContext(SideNavInsetContext)

  return useMemo(() => {
    const frameWidth = Math.max(width - sideNavInset, 0)
    const windowClass = getWindowClass(width)

    return {
      width,
      height,
      fontScale,
      /** The width this screen actually has, after the side navigation. */
      frameWidth,
      windowClass,
      isCompact: windowClass === "compact",
      isExpanded: windowClass === "expanded",
      /** 320-359pt phones: tighten spacing, drop secondary decoration. */
      isSmallPhone: width < SMALL_PHONE_WIDTH,
      isLandscape: width > height,
      gutter: getGutter(frameWidth),
      /** Horizontal padding that centres content at a readable width. */
      paddingFor: (content: ContentWidth = "standard") =>
        getCenteredPadding(frameWidth, CONTENT_MAX_WIDTH[content]),
    }
  }, [fontScale, height, sideNavInset, width])
}

/**
 * Padding for a list or scroll view's `contentContainerStyle`.
 *
 *   <FlashList contentContainerStyle={{ ...useContentPadding(), paddingBottom: 32 }} />
 */
export function useContentPadding(content: ContentWidth = "standard") {
  const { paddingFor } = useLayout()
  const paddingHorizontal = paddingFor(content)

  return useMemo(() => ({ paddingHorizontal }), [paddingHorizontal])
}

/**
 * Column count for a card grid. One column on phones, more once each card can
 * keep `minColumnWidth`.
 */
export function useGridColumns(
  minColumnWidth = 320,
  content: ContentWidth = "standard",
  maxColumns = 3
) {
  const { frameWidth, paddingFor } = useLayout()
  const contentWidth = frameWidth - paddingFor(content) * 2

  return getColumnCount(contentWidth, minColumnWidth, maxColumns)
}
