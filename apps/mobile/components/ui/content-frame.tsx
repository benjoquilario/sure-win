import { View, type ViewProps } from "react-native"

import type { ContentWidth } from "@/lib/layout"
import { useLayout } from "@/hooks/use-layout"

type ContentFrameProps = ViewProps & {
  /** How wide the content may grow. `reading` for text, `standard` for cards. */
  width?: ContentWidth
}

/**
 * Centres its children at a readable width, with the screen gutter.
 *
 * For anything outside a list: a pinned header, a search bar, a footer. Lists
 * take the same measure through `useContentPadding()`, so a header in a
 * `ContentFrame` lines up exactly with the rows scrolling beneath it.
 */
export function ContentFrame({
  width = "standard",
  style,
  ...props
}: ContentFrameProps) {
  const { paddingFor } = useLayout()

  return (
    <View
      style={[{ width: "100%", paddingHorizontal: paddingFor(width) }, style]}
      {...props}
    />
  )
}
