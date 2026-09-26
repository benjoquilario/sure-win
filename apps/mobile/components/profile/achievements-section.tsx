import { memo } from "react"
import { ScrollView, View } from "react-native"

import type { ThemePalette } from "@/lib/theme"
import type { Tone } from "@/lib/tone"
import { useGridColumns, useLayout } from "@/hooks/use-layout"
import { EmptyState } from "@/components/ui/empty-state"
import { SectionHeader } from "@/components/ui/section-header"
import { Skeleton } from "@/components/ui/skeleton"
import { SectionLink } from "@/components/study/section-link"

import { AchievementBadgeCard } from "./achievement-badge-card"
import type { AchievementBadgeMeta } from "./profile-achievements"

export type AchievementCardItem = {
  id: string
  badge: AchievementBadgeMeta
  title: string
  caption: string
  tone: Tone
}

type AchievementsSectionProps = {
  theme: ThemePalette
  items: AchievementCardItem[]
  isLoading: boolean
  onPressSeeAll: () => void
}

export const AchievementsSection = memo(function AchievementsSection({
  theme,
  items,
  isLoading,
  onPressSeeAll,
}: AchievementsSectionProps) {
  const { isCompact, paddingFor } = useLayout()
  // The screen's padding, so the phone rail bleeds to the window edge while
  // its first badge still starts on the content edge.
  const bleed = paddingFor("standard")
  // Up to six across: the preview is six badges, so a wide window shows the
  // whole shelf at once instead of a rail with nothing to scroll.
  const columns = useGridColumns(132, "standard", 6)

  return (
    <View className="gap-3">
      <SectionHeader
        title="Achievements"
        action={
          items.length > 0 ? (
            <SectionLink
              theme={theme}
              label="See all"
              accessibilityLabel="See all achievements"
              onPress={onPressSeeAll}
            />
          ) : null
        }
      />

      {isLoading ? (
        <View className="flex-row gap-3 overflow-hidden">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-[132px] w-[124px] rounded-xl" />
          ))}
        </View>
      ) : items.length === 0 ? (
        // An empty achievements shelf is a prompt, not a dead end — it says
        // what earns the first badge rather than just reporting nothing.
        <EmptyState
          title="No badges yet"
          description="Finish a quiz or keep a study streak going and your first badge lands here."
        />
      ) : isCompact ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -bleed }}
          contentContainerClassName="gap-3"
          contentContainerStyle={{ paddingHorizontal: bleed }}
        >
          {items.map((item) => (
            <AchievementBadgeCard
              key={item.id}
              theme={theme}
              badge={item.badge}
              title={item.title}
              caption={item.caption}
              tone={item.tone}
            />
          ))}
        </ScrollView>
      ) : (
        // Half-gap cells in a row pulled back by the same, so the outer
        // badges sit on the section's edges.
        <View className="-m-1.5 flex-row flex-wrap">
          {items.map((item) => (
            <View
              key={item.id}
              className="p-1.5"
              style={{ width: `${100 / columns}%` }}
            >
              <AchievementBadgeCard
                fill
                theme={theme}
                badge={item.badge}
                title={item.title}
                caption={item.caption}
                tone={item.tone}
              />
            </View>
          ))}
        </View>
      )}
    </View>
  )
})
