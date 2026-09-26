import { memo } from "react"
import Clock from "lucide-react-native/icons/clock"
import Target from "lucide-react-native/icons/target"
import Zap from "lucide-react-native/icons/zap"
import { View } from "react-native"

import type { OverallPerformanceStats } from "@/lib/performance-stats"
import {
  getThemeChartPalette,
  withOpacity,
  type ThemePalette,
} from "@/lib/theme"
import { cn } from "@/lib/utils"
import { useLayout } from "@/hooks/use-layout"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { CircularProgress } from "@/components/ui/circular-progress"
import { SectionHeader } from "@/components/ui/section-header"
import { StatTile } from "@/components/ui/stat-tile"
import { Text } from "@/components/ui/text"

const SubjectBreakdownRow = memo(function SubjectBreakdownRow({
  subjectName,
  correctPercent,
  label,
  colorIndex,
  theme,
  isLast,
}: {
  subjectName: string
  correctPercent: number
  label: "STRONGEST" | null
  colorIndex: number
  theme: ThemePalette
  isLast: boolean
}) {
  const chartPalette = getThemeChartPalette(theme)
  const barColor = chartPalette[colorIndex % chartPalette.length]

  return (
    <View className={cn("py-3.5", !isLast && "border-b border-border/40")}>
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1 flex-row items-center gap-2.5">
          <View
            className="h-6 w-1 rounded-full"
            style={{ backgroundColor: barColor }}
          />
          <Text
            className="flex-1 text-sm font-semibold text-foreground"
            numberOfLines={2}
          >
            {subjectName}
          </Text>
        </View>
        <View className="items-end gap-0.5">
          <Text className="text-base font-extrabold text-foreground">
            {correctPercent}%
          </Text>
          {label ? (
            <Badge tone="success" size="sm">
              {label === "STRONGEST" ? "Strongest" : label}
            </Badge>
          ) : null}
        </View>
      </View>

      <View
        className="ml-4 mt-2.5 h-1 rounded-full"
        style={{ backgroundColor: withOpacity(barColor, 0.12) }}
      >
        <View
          className="h-1 rounded-full"
          style={{
            width: `${Math.min(correctPercent, 100)}%`,
            backgroundColor: barColor,
          }}
        />
      </View>
    </View>
  )
})

const RingStat = memo(function RingStat({
  value,
  total,
  label,
}: {
  value: number
  total: number
  label: string
}) {
  return (
    <View>
      <View className="flex-row flex-wrap items-baseline gap-x-1">
        <Text className="text-2xl font-extrabold text-foreground">{value}</Text>
        <Text className="text-sm font-medium text-muted-foreground">
          of {total}
        </Text>
      </View>
      <Text variant="caption">{label}</Text>
    </View>
  )
})

const PerformanceRingCard = memo(function PerformanceRingCard({
  stats,
  theme,
}: {
  stats: OverallPerformanceStats
  theme: ThemePalette
}) {
  const { isSmallPhone } = useLayout()

  return (
    <Card>
      <CardContent size="loose">
        <View
          className={cn(
            "flex-row items-center",
            isSmallPhone ? "gap-4" : "gap-5"
          )}
        >
          <CircularProgress
            percent={stats.correctPercent}
            size={isSmallPhone ? 104 : 130}
            strokeWidth={10}
            trackColor={withOpacity(theme.primary, 0.1)}
            color={theme.success}
          />
          <View className="flex-1 gap-4">
            <RingStat
              value={stats.uniqueQuestionsAnswered}
              total={stats.totalQuestions}
              label="Unique Questions Answered"
            />
            <RingStat
              value={stats.correctAnswers}
              total={stats.totalAnswered}
              label="Correct Answers"
            />
          </View>
        </View>
      </CardContent>
    </Card>
  )
})

const PerformanceQuickStats = memo(function PerformanceQuickStats({
  stats,
  theme,
}: {
  stats: OverallPerformanceStats
  theme: ThemePalette
}) {
  const avgMinutes = Math.floor(stats.averageTimePerQuestion / 60)
  const avgSeconds = stats.averageTimePerQuestion % 60

  return (
    <View className="flex-row gap-3">
      <StatTile
        className="flex-1"
        icon={<Clock size={14} color={theme.primary} />}
        label="Avg. Time"
        value={`${avgMinutes}m ${avgSeconds}s`}
        caption="per question"
      />
      <StatTile
        className="flex-1"
        icon={<Zap size={14} color={theme.accentText} />}
        label="Best Streak"
        value={String(stats.bestStreak)}
        caption="correct in a row"
      />
    </View>
  )
})

const PerformanceCategoryBreakdown = memo(
  function PerformanceCategoryBreakdown({
    stats,
    theme,
  }: {
    stats: OverallPerformanceStats
    theme: ThemePalette
  }) {
    return (
      <Card>
        <CardContent className="pb-1">
          <View className="mb-1 flex-row items-center gap-2.5">
            <View
              className="h-8 w-8 items-center justify-center rounded-sm"
              style={{ backgroundColor: withOpacity(theme.chart4, 0.12) }}
            >
              <Target size={14} color={theme.chart4} />
            </View>
            <Text variant="subheading">Category Breakdown</Text>
          </View>
          {stats.subjectBreakdown.map((subject, index) => (
            <SubjectBreakdownRow
              key={subject.subjectId}
              subjectName={subject.subjectName}
              correctPercent={subject.correctPercent}
              label={subject.label}
              colorIndex={index}
              theme={theme}
              isLast={index === stats.subjectBreakdown.length - 1}
            />
          ))}
        </CardContent>
      </Card>
    )
  }
)

export const OverallPerformanceSection = memo(
  function OverallPerformanceSection({
    stats,
    theme,
  }: {
    stats: OverallPerformanceStats
    theme: ThemePalette
  }) {
    return (
      <View className="gap-3">
        <SectionHeader
          eyebrow="Performance Insights"
          title="Overall Performance"
        />
        <PerformanceRingCard stats={stats} theme={theme} />
        <PerformanceQuickStats stats={stats} theme={theme} />
        <PerformanceCategoryBreakdown stats={stats} theme={theme} />
      </View>
    )
  }
)
