import { memo } from "react"
import BarChart3 from "lucide-react-native/icons/chart-column"
import ChevronLeft from "lucide-react-native/icons/chevron-left"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import Clock3 from "lucide-react-native/icons/clock-3"
import Flame from "lucide-react-native/icons/flame"
import Trophy from "lucide-react-native/icons/trophy"
import { Pressable, View } from "react-native"

import type {
  DashboardReportMetrics,
  QuestionsAnsweredTimeline,
  TimelineWindow,
} from "@/lib/performance-stats"
import type { ThemePalette } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { IconButton } from "@/components/ui/icon-button"
import { SectionHeader } from "@/components/ui/section-header"
import { Skeleton } from "@/components/ui/skeleton"
import { StatTile } from "@/components/ui/stat-tile"
import { Text } from "@/components/ui/text"

import { BarChart } from "./bar-chart"

const WINDOWS: TimelineWindow[] = ["week", "month", "year"]
const WINDOW_LABELS: Record<TimelineWindow, string> = {
  week: "Week",
  month: "Month",
  year: "Year",
}

const WindowToggle = memo(function WindowToggle({
  active,
  onSelect,
}: {
  active: TimelineWindow
  onSelect: (w: TimelineWindow) => void
}) {
  return (
    <View
      role="tablist"
      className="flex-row self-start rounded-full bg-primary/10 p-1"
    >
      {WINDOWS.map((w) => {
        const isActive = w === active
        return (
          <Pressable
            key={w}
            role="tab"
            accessibilityState={{ selected: isActive }}
            hitSlop={4}
            onPress={() => onSelect(w)}
            className={cn(
              "h-9 items-center justify-center rounded-full px-4",
              isActive ? "bg-primary" : "web:hover:bg-primary/10"
            )}
          >
            <Text
              className={cn(
                "text-xs font-bold",
                isActive ? "text-primary-foreground" : "text-muted-foreground"
              )}
            >
              {WINDOW_LABELS[w]}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
})

const DateNavigator = memo(function DateNavigator({
  rangeLabel,
  onPrev,
  onNext,
  onToday,
  theme,
}: {
  rangeLabel: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  theme: ThemePalette
}) {
  return (
    <View className="flex-row items-center justify-between gap-2">
      <Text
        className="flex-1 text-sm font-bold text-foreground"
        numberOfLines={1}
      >
        {rangeLabel}
      </Text>
      <View className="flex-row items-center gap-1.5">
        <IconButton
          label="Previous period"
          variant="soft"
          size="sm"
          onPress={onPrev}
        >
          <ChevronLeft size={16} color={theme.primary} />
        </IconButton>
        <Pressable
          role="button"
          hitSlop={4}
          onPress={onToday}
          className="h-10 items-center justify-center rounded-lg bg-primary/10 px-3.5 active:bg-primary/15 web:hover:bg-primary/15"
        >
          <Text className="text-xs font-bold text-primary">Today</Text>
        </Pressable>
        <IconButton
          label="Next period"
          variant="soft"
          size="sm"
          onPress={onNext}
        >
          <ChevronRight size={16} color={theme.primary} />
        </IconButton>
      </View>
    </View>
  )
})

export const ActivityMetricsSection = memo(function ActivityMetricsSection({
  timeline,
  reportMetrics,
  isLoading,
  window,
  onWindowChange,
  selectedBarIndex,
  onSelectBar,
  onPrev,
  onNext,
  onToday,
  theme,
  isWide = false,
}: {
  timeline: QuestionsAnsweredTimeline | null
  reportMetrics: DashboardReportMetrics | null
  isLoading: boolean
  window: TimelineWindow
  onWindowChange: (w: TimelineWindow) => void
  selectedBarIndex: number | null
  onSelectBar: (index: number) => void
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  theme: ThemePalette
  /** Room for the four snapshot tiles in one row instead of a 2×2 grid. */
  isWide?: boolean
}) {
  const periodLabel =
    window === "week"
      ? "This Week"
      : window === "month"
        ? "This Month"
        : "This Year"
  const reportCards = reportMetrics
    ? [
        reportMetrics.today,
        reportMetrics.week,
        reportMetrics.month,
        reportMetrics.year,
      ]
    : []
  // A basis under a half (or a quarter) leaves room for the gap; flexGrow
  // then fills the row, so tiles wrap into an even grid at any width.
  const snapshotBasis = isWide ? "22%" : "40%"

  return (
    <View className="gap-6">
      <View className="gap-3">
        <SectionHeader eyebrow="Activity Metrics" title="Questions Answered" />

        <WindowToggle active={window} onSelect={onWindowChange} />

        {isLoading ? (
          <Skeleton className="h-36 rounded-xl" />
        ) : timeline ? (
          <Card>
            <CardContent className="gap-4">
              <BarChart
                timeline={timeline}
                theme={theme}
                selectedBarIndex={selectedBarIndex}
                onSelectBar={onSelectBar}
              />
              <DateNavigator
                rangeLabel={timeline.rangeLabel}
                onPrev={onPrev}
                onNext={onNext}
                onToday={onToday}
                theme={theme}
              />
            </CardContent>
          </Card>
        ) : null}

        {timeline ? (
          <View className="flex-row gap-3">
            <StatTile
              className="flex-1"
              icon={<BarChart3 size={14} color={theme.primary} />}
              label={periodLabel}
              value={String(timeline.questionsThisPeriod)}
              caption="questions answered"
            />
            <StatTile
              className="flex-1"
              icon={<Trophy size={14} color={theme.accentText} />}
              label="Best Day"
              value={String(timeline.mostAnsweredInOneDay)}
              caption={timeline.mostAnsweredDate}
            />
          </View>
        ) : null}
      </View>

      {reportMetrics ? (
        <View className="gap-3">
          <SectionHeader
            eyebrow="Report Snapshots"
            title="Daily to Yearly Progress"
          />

          <View className="flex-row flex-wrap gap-3">
            {reportCards.map((snapshot) => (
              <StatTile
                key={snapshot.label}
                style={{ flexBasis: snapshotBasis, flexGrow: 1 }}
                label={snapshot.label}
                value={String(snapshot.answeredCount)}
                caption={[
                  `answered · ${snapshot.accuracyRate}% accuracy`,
                  `${snapshot.studyMinutes} min · ${snapshot.activeDaysCount} active day${snapshot.activeDaysCount === 1 ? "" : "s"}`,
                  `${snapshot.earnedAchievementsCount} achievements earned`,
                ].join("\n")}
              />
            ))}
          </View>

          <Card>
            <CardContent className="gap-3">
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1 gap-1">
                  <Text variant="eyebrow">Lifetime Summary</Text>
                  <Text variant="subheading">Long-term reviewer momentum</Text>
                </View>
                <Badge tone="primary">
                  {`${reportMetrics.lifetime.achievementsCount} badges`}
                </Badge>
              </View>

              <View className="flex-row flex-wrap gap-3">
                <StatTile
                  style={{ flexBasis: "40%", flexGrow: 1 }}
                  icon={<Flame size={14} color={theme.accentText} />}
                  label="Current Streak"
                  value={String(reportMetrics.lifetime.dayStreak)}
                  caption="consecutive days"
                />
                <StatTile
                  style={{ flexBasis: "40%", flexGrow: 1 }}
                  icon={<Clock3 size={14} color={theme.primary} />}
                  label="Study Time"
                  value={String(reportMetrics.lifetime.totalStudyMinutes)}
                  caption="minutes tracked"
                />
              </View>
            </CardContent>
          </Card>
        </View>
      ) : null}
    </View>
  )
})
