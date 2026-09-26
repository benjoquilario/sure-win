import { memo } from "react"
import { ScrollView, View } from "react-native"

import { useLayout } from "@/hooks/use-layout"
import { SectionHeader } from "@/components/ui/section-header"

import { QuickActionTile, type QuickActionIcon } from "./QuickActionTile"

export type QuickAction = {
  key: string
  Icon: QuickActionIcon
  label: string
  color: string
  onPress: () => void
}

type QuickActionsSectionProps = {
  actions: QuickAction[]
}

/**
 * The five shortcuts under the progress card.
 *
 * On a phone the row scrolls horizontally rather than being a fixed five-across
 * row: five 64px tiles plus gaps fit a 360px screen exactly, with nothing left
 * for a sixth or for larger text settings. Scrolling means adding an action
 * never squeezes the labels, and on a normal screen there is nothing to scroll
 * so it reads as a static row.
 *
 * From the medium window class up there is room to spare, and a strip of 64px
 * tiles huddled at the left of a tablet reads as unfinished. There the tiles
 * share the row equally instead.
 */
export const QuickActionsSection = memo(function QuickActionsSection({
  actions,
}: QuickActionsSectionProps) {
  const { isCompact, paddingFor } = useLayout()
  // The screen's own padding, so the tiles can bleed to the window edge while
  // the first one still starts on the content edge.
  const bleed = paddingFor("standard")

  return (
    <View className="gap-3">
      <SectionHeader title="Quick Actions" />

      {isCompact ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -bleed }}
          contentContainerClassName="gap-3"
          contentContainerStyle={{ paddingHorizontal: bleed }}
        >
          {actions.map((action) => (
            <QuickActionTile
              key={action.key}
              Icon={action.Icon}
              label={action.label}
              color={action.color}
              onPress={action.onPress}
            />
          ))}
        </ScrollView>
      ) : (
        <View className="flex-row gap-3">
          {actions.map((action) => (
            <QuickActionTile
              key={action.key}
              fill
              Icon={action.Icon}
              label={action.label}
              color={action.color}
              onPress={action.onPress}
            />
          ))}
        </View>
      )}
    </View>
  )
})
