import { memo } from "react"
import type { LucideIcon } from "lucide-react-native"
import { ScrollView, View } from "react-native"

import type { ThemePalette } from "@/lib/theme"
import { useLayout } from "@/hooks/use-layout"
import { EmptyState } from "@/components/ui/empty-state"
import { SectionHeader } from "@/components/ui/section-header"
import { Skeleton } from "@/components/ui/skeleton"

import { SectionLink } from "./section-link"
import { SubjectProgressCard } from "./subject-progress-card"

export type SubjectRailItem = {
  id: string
  title: string
  Icon: LucideIcon
  color: string
  completed: number
  total: number
  percent: number
  unitLabel: string
  isLocked: boolean
}

type SubjectProgressSectionProps = {
  theme: ThemePalette
  title: string
  seeAllLabel?: string
  items: SubjectRailItem[]
  isLoading: boolean
  errorMessage: string | null
  onPressItem: (item: SubjectRailItem) => void
  onPressSeeAll: () => void
}

function SubjectRailSkeleton() {
  return (
    <View className="flex-row gap-3">
      {[0, 1, 2].map((key) => (
        <Skeleton key={key} className="h-[150px] w-[148px] rounded-xl" />
      ))}
    </View>
  )
}

export const SubjectProgressSection = memo(function SubjectProgressSection({
  theme,
  title,
  seeAllLabel = "See all",
  items,
  isLoading,
  errorMessage,
  onPressItem,
  onPressSeeAll,
}: SubjectProgressSectionProps) {
  const { gutter } = useLayout()

  return (
    <View className="gap-3">
      <SectionHeader
        title={title}
        action={
          <SectionLink
            theme={theme}
            label={seeAllLabel}
            accessibilityLabel="See all subjects"
            onPress={onPressSeeAll}
          />
        }
      />

      {isLoading ? (
        <SubjectRailSkeleton />
      ) : errorMessage ? (
        <EmptyState
          tone="destructive"
          title="Subjects unavailable"
          description={errorMessage}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="No subjects yet"
          description="Once subjects are published they will show up here with your progress."
        />
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // Bleeds by exactly the gutter, so the rail runs to the screen edge
          // on a phone (12pt under 360pt, not a hardcoded 16 that overflows)
          // and stays inside the content column where the padding is wider.
          style={{ marginHorizontal: -gutter }}
          contentContainerClassName="gap-3"
          contentContainerStyle={{ paddingHorizontal: gutter }}
        >
          {items.map((item) => (
            <SubjectProgressCard
              key={item.id}
              theme={theme}
              Icon={item.Icon}
              title={item.title}
              completed={item.completed}
              total={item.total}
              percent={item.percent}
              unitLabel={item.unitLabel}
              color={item.color}
              isLocked={item.isLocked}
              onPress={() => onPressItem(item)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  )
})
