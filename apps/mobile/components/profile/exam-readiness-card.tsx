import { memo } from "react"
import CalendarDays from "lucide-react-native/icons/calendar-days"
import ChevronRight from "lucide-react-native/icons/chevron-right"
import { Pressable, View } from "react-native"

import { DEFAULT_PASSING_SCORE } from "@/lib/content/paper-rules"
import type { ExamCountdown } from "@/lib/exam-countdown"
import { useThemePalette } from "@/hooks/use-theme"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { CircularProgress } from "@/components/ui/circular-progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Text } from "@/components/ui/text"

/**
 * ─── Exam readiness ───────────────────────────────────────────────────────
 *
 * The one question a reviewer's profile exists to answer: "am I going to
 * pass, and how long do I have?". Score against the pass mark on one side,
 * the countdown on the other, and a single next action.
 *
 * The verdict is stated as a gap in points rather than a pass/fail word. A
 * member at 71% is four points away, which is a plan; "Failing" is not.
 */

type ExamReadinessCardProps = {
  isLoading: boolean
  /** Average score across finished sittings, 0-100. */
  averageScore: number
  /** Finished sittings the average is built from. */
  sittings: number
  countdown: ExamCountdown | null
  onSetExamDate: () => void
  onPractice: () => void
}

function describeGap(score: number) {
  const gap = DEFAULT_PASSING_SCORE - score

  if (gap <= 0) {
    return {
      title: "On track to pass",
      detail: `${Math.abs(gap)} ${Math.abs(gap) === 1 ? "point" : "points"} above the ${DEFAULT_PASSING_SCORE}% passing mark.`,
      tone: "success" as const,
    }
  }

  return {
    title: gap <= 10 ? "Almost there" : "Keep building",
    detail: `${gap} ${gap === 1 ? "point" : "points"} to reach the ${DEFAULT_PASSING_SCORE}% passing mark.`,
    tone: gap <= 10 ? ("warning" as const) : ("destructive" as const),
  }
}

export const ExamReadinessCard = memo(function ExamReadinessCard({
  isLoading,
  averageScore,
  sittings,
  countdown,
  onSetExamDate,
  onPractice,
}: ExamReadinessCardProps) {
  const theme = useThemePalette()

  if (isLoading) {
    return <Skeleton className="h-48 rounded-xl" />
  }

  const hasData = sittings > 0
  const score = Math.round(averageScore)
  const verdict = hasData ? describeGap(score) : null
  const ringColor =
    verdict?.tone === "success"
      ? theme.success
      : verdict?.tone === "warning"
        ? theme.accentText
        : verdict?.tone === "destructive"
          ? theme.destructive
          : theme.mutedForeground

  return (
    <Card>
      <CardContent className="gap-3.5">
        <View className="flex-row items-center gap-4">
          <CircularProgress
            percent={hasData ? score : 0}
            size={84}
            strokeWidth={8}
            color={ringColor}
            label="AVERAGE"
          />

          <View className="min-w-0 flex-1 gap-1">
            <Text variant="eyebrow" className="text-muted-foreground">
              Exam readiness
            </Text>
            <Text className="text-lg font-extrabold text-card-foreground">
              {verdict?.title ?? "No sittings yet"}
            </Text>
            <Text variant="caption">
              {verdict
                ? `${verdict.detail} Based on ${sittings} ${sittings === 1 ? "sitting" : "sittings"}.`
                : "Finish a quiz or board exam paper and your readiness appears here."}
            </Text>
          </View>
        </View>

        <Pressable
          onPress={onSetExamDate}
          role="button"
          accessibilityLabel={
            countdown
              ? `Board exam in ${countdown.daysLabel} ${countdown.daysCaption}. Change date`
              : "Set your board exam date"
          }
          className="flex-row items-center gap-3 rounded-md bg-muted px-3 py-2.5 active:opacity-80 web:hover:bg-muted/70"
        >
          <View className="h-9 w-9 items-center justify-center rounded-sm bg-accent/15">
            <CalendarDays
              size={18}
              color={theme.accentText}
              strokeWidth={2.2}
            />
          </View>

          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-sm font-semibold text-card-foreground">
              {countdown
                ? countdown.isPast
                  ? "Your exam date has passed"
                  : `${countdown.daysLabel} ${countdown.daysCaption}`
                : "Set your board exam date"}
            </Text>
            <Text variant="caption" numberOfLines={1}>
              {countdown
                ? countdown.scheduleLabel
                : "We count down the days and pace your review."}
            </Text>
          </View>

          <ChevronRight
            size={18}
            color={theme.mutedForeground}
            strokeWidth={2.2}
          />
        </Pressable>

        <Button onPress={onPractice}>
          <Text>
            {hasData ? "Continue practising" : "Start your first sitting"}
          </Text>
        </Button>
      </CardContent>
    </Card>
  )
})
