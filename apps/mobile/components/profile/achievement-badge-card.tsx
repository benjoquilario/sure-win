import { memo } from "react"
import { Pressable, View } from "react-native"

import { withOpacity, type ThemePalette } from "@/lib/theme"
import { getToneColor, type Tone } from "@/lib/tone"
import { cn } from "@/lib/utils"
import { Text } from "@/components/ui/text"

import { AchievementBadgeIcon } from "./profile-achievements"
import type { AchievementBadgeMeta } from "./profile-achievements"

type AchievementBadgeCardProps = {
  theme: ThemePalette
  badge: AchievementBadgeMeta
  /** The achievement's own title, e.g. "Consistent Learner". */
  title: string
  /** One-line context, e.g. "7-day streak". */
  caption: string
  tone: Tone
  onPress?: () => void
  /** Fill a grid cell instead of the fixed 124pt rail width. */
  fill?: boolean
}

/**
 * One earned badge.
 *
 * The medallion is a filled disc rather than an outline: an achievement is the
 * app's reward moment, and a hollow shape reads as a placeholder for something
 * not yet earned. Every badge on this rail has been earned, so they all get
 * the solid treatment and the tone carries which kind it is.
 */
export const AchievementBadgeCard = memo(function AchievementBadgeCard({
  theme,
  badge,
  title,
  caption,
  tone,
  onPress,
  fill = false,
}: AchievementBadgeCardProps) {
  const toneColor = getToneColor(theme, tone)

  const body = (
    <View
      className={cn(
        "items-center gap-2 rounded-xl border border-border/80 bg-card p-3.5",
        fill ? "w-full" : "w-[124px]"
      )}
    >
      <View
        className="h-14 w-14 items-center justify-center rounded-2xl"
        style={{ backgroundColor: toneColor }}
      >
        <View
          className="h-10 w-10 items-center justify-center rounded-lg"
          style={{ backgroundColor: withOpacity(theme.card, 0.22) }}
        >
          <AchievementBadgeIcon
            icon={badge.icon}
            color={theme.card}
            size={20}
          />
        </View>
      </View>

      <Text
        variant="caption"
        numberOfLines={2}
        className="text-center text-xs font-bold text-card-foreground"
      >
        {title}
      </Text>

      <Text
        variant="caption"
        numberOfLines={2}
        className="text-center text-2xs"
      >
        {caption}
      </Text>
    </View>
  )

  if (!onPress) {
    return body
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${caption}. ${badge.badgeName}.`}
      onPress={onPress}
      className="active:opacity-85"
    >
      {body}
    </Pressable>
  )
})
