import { memo } from "react"
import { View } from "react-native"

import type { ThemePalette } from "@/lib/theme"
import { Card, CardContent } from "@/components/ui/card"
import { ProgressBar } from "@/components/ui/progress-bar"
import { SectionHeader } from "@/components/ui/section-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Text } from "@/components/ui/text"
import { SectionLink } from "@/components/study/section-link"

/**
 * ─── Learning progress ────────────────────────────────────────────────────
 *
 * How much of the reading library is done. One bar and one sentence: the
 * previous version showed "Topics studied 12" and "Topics completed 12/40"
 * side by side, the same number twice under two names.
 */

type ProfileProgressCardProps = {
  theme: ThemePalette
  isLoading: boolean
  progressPercent: number
  /** Lessons finished. */
  topicsStudied: number
  /** Lessons in the library. */
  topicsTotal: number
  onPressViewDetails: () => void
}

export const ProfileProgressCard = memo(function ProfileProgressCard({
  theme,
  isLoading,
  progressPercent,
  topicsStudied,
  topicsTotal,
  onPressViewDetails,
}: ProfileProgressCardProps) {
  const safePercent = Math.min(Math.max(Math.round(progressPercent), 0), 100)

  return (
    <View className="gap-3">
      <SectionHeader
        title="Learning progress"
        subtitle="Lessons completed across the review library."
        action={
          <SectionLink
            theme={theme}
            label="Performance"
            accessibilityLabel="Open performance dashboard"
            onPress={onPressViewDetails}
          />
        }
      />

      {isLoading ? (
        <Skeleton className="h-28 rounded-xl" />
      ) : (
        <Card>
          <CardContent className="gap-3">
            <View className="flex-row items-end justify-between gap-3">
              <View className="gap-0.5">
                <Text className="text-3xl font-extrabold text-card-foreground">
                  {safePercent}%
                </Text>
                <Text variant="caption">complete</Text>
              </View>
              <Text
                variant="callout"
                className="text-right text-muted-foreground"
              >
                {topicsTotal > 0
                  ? `${topicsStudied} of ${topicsTotal} lessons`
                  : "No lessons published yet"}
              </Text>
            </View>

            <ProgressBar
              size="lg"
              value={safePercent}
              label="Learning progress"
            />
          </CardContent>
        </Card>
      )}
    </View>
  )
})
