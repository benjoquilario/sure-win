import { memo } from "react"
import Award from "lucide-react-native/icons/award"
import Flame from "lucide-react-native/icons/flame"
import ShieldAlert from "lucide-react-native/icons/shield-alert"
import TrendingDown from "lucide-react-native/icons/trending-down"
import TrendingUp from "lucide-react-native/icons/trending-up"
import { View } from "react-native"

import type {
  AchievementHighlight,
  DashboardInsights,
  DashboardTrendSnapshot,
} from "@/lib/performance-stats"
import { withOpacity, type ThemePalette } from "@/lib/theme"
import {
  getToneColor,
  TONE_SURFACE_CLASS,
  TONE_TEXT_CLASS,
  type Tone,
} from "@/lib/tone"
import { cn } from "@/lib/utils"
import { useLayout } from "@/hooks/use-layout"
import { Card, CardContent } from "@/components/ui/card"
import { SectionHeader } from "@/components/ui/section-header"
import { StatTile } from "@/components/ui/stat-tile"
import { Text } from "@/components/ui/text"

function formatAchievementDate(value: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(value))
  } catch {
    return value
  }
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value}`
}

const TrendCard = memo(function TrendCard({
  snapshot,
  theme,
}: {
  snapshot: DashboardTrendSnapshot
  theme: ThemePalette
}) {
  const tone: Tone =
    snapshot.trend === "up"
      ? "success"
      : snapshot.trend === "down"
        ? "warning"
        : "primary"
  const toneColor = getToneColor(theme, tone)
  const TrendIcon =
    snapshot.trend === "up"
      ? TrendingUp
      : snapshot.trend === "down"
        ? TrendingDown
        : Flame

  return (
    <Card className="flex-1">
      <CardContent size="compact" className="gap-1.5">
        <View className="flex-row items-center justify-between gap-2">
          <Text variant="label" className="flex-1" numberOfLines={1}>
            {snapshot.label}
          </Text>
          <View
            className="h-7 w-7 items-center justify-center rounded-xs"
            style={{ backgroundColor: withOpacity(toneColor, 0.14) }}
          >
            <TrendIcon size={14} color={toneColor} />
          </View>
        </View>
        <Text className="text-2xl font-extrabold text-foreground">
          {snapshot.currentAnsweredCount}
        </Text>
        <Text variant="caption">
          {snapshot.currentLabel} answered{"\n"}
          {signed(snapshot.answeredDelta)} vs {snapshot.previousLabel}
          {"\n"}
          {signed(snapshot.accuracyDelta)}% accuracy,{" "}
          {signed(snapshot.studyMinutesDelta)} min
        </Text>
      </CardContent>
    </Card>
  )
})

const SubjectFocusRow = memo(function SubjectFocusRow({
  label,
  subjectName,
  percent,
  answered,
  tone,
}: {
  label: string
  subjectName: string
  percent: number
  answered: number
  tone: Tone
}) {
  return (
    <View
      className={cn(
        "gap-0.5 rounded-sm border px-3.5 py-3",
        TONE_SURFACE_CLASS[tone]
      )}
    >
      <Text
        className={cn(
          "text-2xs font-bold uppercase tracking-[1px]",
          TONE_TEXT_CLASS[tone]
        )}
      >
        {label}
      </Text>
      <Text className="text-sm font-bold text-foreground">{subjectName}</Text>
      <Text variant="caption">
        {percent}% accuracy across {answered} answers
      </Text>
    </View>
  )
})

const AchievementRow = memo(function AchievementRow({
  achievement,
  isLast,
}: {
  achievement: AchievementHighlight
  isLast: boolean
}) {
  return (
    <View
      className={cn("gap-0.5 py-2.5", !isLast && "border-b border-border/50")}
    >
      <Text className="text-sm font-bold text-foreground">
        {achievement.title}
      </Text>
      <Text variant="caption">
        {achievement.description ?? "Milestone unlocked"}
      </Text>
      <Text variant="eyebrow" className="mt-0.5">
        {achievement.achievementType.replaceAll("_", " ")} -{" "}
        {formatAchievementDate(achievement.earnedAt)}
      </Text>
    </View>
  )
})

function InsightCardTitle({
  icon,
  title,
}: {
  icon: React.ReactNode
  title: string
}) {
  return (
    <View className="flex-row items-center gap-2">
      {icon}
      <Text variant="subheading">{title}</Text>
    </View>
  )
}

export const ProgressInsightsSection = memo(function ProgressInsightsSection({
  insights,
  theme,
}: {
  insights: DashboardInsights
  theme: ThemePalette
}) {
  const { isCompact } = useLayout()
  const strongest = insights.strongestSubject
  const weakest = insights.weakestSubject

  return (
    <View className="gap-3">
      <SectionHeader
        eyebrow="Review Insights"
        title="Momentum, focus, and achievements"
      />

      {/* Side by side once a phone's width no longer squeezes the deltas. */}
      <View className={isCompact ? "gap-3" : "flex-row gap-3"}>
        <TrendCard snapshot={insights.weekOverWeek} theme={theme} />
        <TrendCard snapshot={insights.monthOverMonth} theme={theme} />
      </View>

      <Card>
        <CardContent className="gap-3">
          <InsightCardTitle
            icon={<Flame size={16} color={theme.accentText} />}
            title="Consistency Target"
          />
          <View className="flex-row flex-wrap gap-3">
            <StatTile
              style={{ flexBasis: "40%", flexGrow: 1 }}
              label="Active This Week"
              value={`${insights.consistency.currentWeekActiveDays}/${insights.consistency.targetActiveDays}`}
              caption={
                insights.consistency.remainingDaysToGoal === 0
                  ? "Weekly consistency goal reached"
                  : `${insights.consistency.remainingDaysToGoal} more active day(s) to goal`
              }
            />
            <StatTile
              style={{ flexBasis: "40%", flexGrow: 1 }}
              label="Streak and Score"
              value={`${insights.consistency.currentStreak} days`}
              caption={`${Math.round(insights.consistency.weeklyAverageScore)}% weekly average`}
            />
          </View>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="gap-3">
          <InsightCardTitle
            icon={<ShieldAlert size={16} color={theme.accentText} />}
            title="Subject Focus"
          />
          <View className="gap-2.5">
            {strongest ? (
              <SubjectFocusRow
                label="Strongest Right Now"
                subjectName={strongest.subjectName}
                percent={strongest.correctPercent}
                answered={strongest.totalAnswered}
                tone="success"
              />
            ) : null}
            {weakest ? (
              <SubjectFocusRow
                label="Needs Review"
                subjectName={weakest.subjectName}
                percent={weakest.correctPercent}
                answered={weakest.totalAnswered}
                tone="warning"
              />
            ) : null}
            <Text variant="caption">
              {insights.focusSubjects.length > 0
                ? `Focus next on ${insights.focusSubjects.map((subject) => subject.subjectName).join(", ")} to raise your weakest areas faster.`
                : "Keep answering more board exam questions to unlock subject-specific recommendations."}
            </Text>
          </View>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="gap-1">
          <InsightCardTitle
            icon={<Award size={16} color={theme.primary} />}
            title="Recent Achievements"
          />
          {insights.recentAchievements.length === 0 ? (
            <Text variant="caption" className="mt-2">
              No achievements earned yet. Finish quizzes, stay consistent, and
              complete materials to start building your badge history.
            </Text>
          ) : (
            insights.recentAchievements.map((achievement, index) => (
              <AchievementRow
                key={achievement.id}
                achievement={achievement}
                isLast={index === insights.recentAchievements.length - 1}
              />
            ))
          )}
        </CardContent>
      </Card>
    </View>
  )
})
