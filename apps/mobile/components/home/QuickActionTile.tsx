import { memo, type ComponentType } from "react"
import { Pressable, View } from "react-native"

import { withOpacity } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { Text } from "@/components/ui/text"

export type QuickActionIcon = ComponentType<{
  size: number
  color: string
  strokeWidth?: number
}>

type QuickActionTileProps = {
  Icon: QuickActionIcon
  label: string
  /** Resolved palette colour — one of the chart hues, kept distinct per tile. */
  color: string
  onPress: () => void
  /** Share the row equally instead of the fixed 64px phone tile. */
  fill?: boolean
}

/**
 * One tile in the Quick Actions row: a tinted icon square over a short label.
 *
 * The tint is the icon's own colour at 12%, so the swatch and glyph always
 * agree and the row stays legible in both schemes without a `dark:` variant.
 * Each tile owns a distinct hue purely to make the row scannable — the colour
 * is a wayfinding aid, not a status, so nothing here should read as semantic.
 */
export const QuickActionTile = memo(function QuickActionTile({
  Icon,
  label,
  color,
  onPress,
  fill = false,
}: QuickActionTileProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      // 64px wide keeps five tiles on a 360px screen with the row's gaps, and
      // the 64px height clears the 44pt minimum target on its own.
      className={cn(
        "items-center gap-2 active:opacity-75",
        fill ? "min-w-0 flex-1" : "w-16"
      )}
    >
      <View
        className={cn(
          "h-16 items-center justify-center rounded-lg border border-border/70 bg-card web:hover:bg-muted/60",
          fill ? "w-full" : "w-16"
        )}
      >
        <View
          className="h-9 w-9 items-center justify-center rounded-md"
          style={{ backgroundColor: withOpacity(color, 0.12) }}
        >
          <Icon size={19} color={color} strokeWidth={2.3} />
        </View>
      </View>

      <Text
        variant="caption"
        numberOfLines={2}
        className="text-center text-2xs text-foreground"
      >
        {label}
      </Text>
    </Pressable>
  )
})
