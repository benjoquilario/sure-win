import { memo } from "react"
import CircleCheck from "lucide-react-native/icons/circle-check"
import CircleMinus from "lucide-react-native/icons/circle-minus"
import CircleX from "lucide-react-native/icons/circle-x"
import Target from "lucide-react-native/icons/target"
import Timer from "lucide-react-native/icons/timer"
import TrendingUp from "lucide-react-native/icons/trending-up"
import Trophy from "lucide-react-native/icons/trophy"
import { View } from "react-native"

import { withOpacity } from "@/lib/theme"
import { useThemePalette } from "@/hooks/use-theme"
import { Card, CardContent } from "@/components/ui/card"
import { CircularProgress } from "@/components/ui/circular-progress"
import { Text } from "@/components/ui/text"

/**
 * The end of a sitting.
 *
 * This is the moment the member remembers — the peak of the whole flow — so it
 * leads with the number, names it in words, and says how far it sits from the
 * pass mark, which is the question a board-exam reviewer is actually asking.
 * The four tiles below break the score into what happened.
 */

/**
 * The pass mark when neither the set nor the category sets one. Shown as a
 * line, not a pass/fail verdict. Encoders override it per paper in the CMS.
 */
export const PASSING_SCORE = 75

type ResultSummaryProps = {
  correctCount: number
  questionCount: number
  answeredCount: number
  durationSeconds: number
  label: string
  /** This paper's pass mark, already resolved from set and category. */
  passingScore?: number
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(Math.max(totalSeconds, 0) / 60)
  const seconds = Math.max(totalSeconds, 0) % 60

  if (minutes === 0) {
    return `${seconds}s`
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`
}

type Tone = "success" | "warning" | "destructive"

function getVerdict(percent: number, passingScore: number) {
  if (percent >= 90) {
    return { title: "Outstanding", tone: "success" as Tone, Icon: Trophy }
  }

  if (percent >= passingScore) {
    return {
      title: "Above the line",
      tone: "success" as Tone,
      Icon: CircleCheck,
    }
  }

  // "Close" scales with the bar, so a paper set at 60% does not call 61%
  // "close" to a line it has already cleared.
  if (percent >= passingScore - 15) {
    return { title: "Close", tone: "warning" as Tone, Icon: TrendingUp }
  }

  return { title: "Keep drilling", tone: "destructive" as Tone, Icon: Target }
}

/** The score against the pass mark, in percentage points. */
function describeMargin(percent: number, passingScore: number) {
  const margin = percent - passingScore

  if (margin === 0) {
    return `Right on the ${passingScore}% pass mark`
  }

  const points = `${Math.abs(margin)} ${Math.abs(margin) === 1 ? "point" : "points"}`

  return margin > 0
    ? `${points} above the ${passingScore}% pass mark`
    : `${points} short of the ${passingScore}% pass mark`
}

export const ResultSummary = memo(function ResultSummary({
  correctCount,
  questionCount,
  answeredCount,
  durationSeconds,
  label,
  passingScore = PASSING_SCORE,
}: ResultSummaryProps) {
  const theme = useThemePalette()
  const percent = Math.round((correctCount / Math.max(questionCount, 1)) * 100)
  const verdict = getVerdict(percent, passingScore)
  const wrongCount = Math.max(answeredCount - correctCount, 0)
  const skippedCount = Math.max(questionCount - answeredCount, 0)

  const accent =
    verdict.tone === "success"
      ? theme.success
      : verdict.tone === "warning"
        ? theme.accentText
        : theme.destructive

  return (
    <Card>
      <CardContent className="gap-4">
        <View
          className="flex-row items-center gap-4"
          accessible
          accessibilityLabel={`${label}. ${percent} percent, ${verdict.title}. ${correctCount} of ${questionCount} correct. ${describeMargin(percent, passingScore)}.`}
        >
          <CircularProgress
            percent={percent}
            size={104}
            strokeWidth={9}
            color={accent}
            label="Score"
          />

          <View className="min-w-0 flex-1 gap-1.5">
            <Text variant="eyebrow" numberOfLines={2}>
              {label}
            </Text>

            {/* The word matters as much as the number: a percentage alone
                does not say whether it was good. */}
            <View className="flex-row items-center gap-1.5">
              <verdict.Icon size={18} color={accent} strokeWidth={2.4} />
              <Text
                className="text-xl font-black leading-7"
                style={{ color: accent }}
              >
                {verdict.title}
              </Text>
            </View>

            <Text className="text-sm font-semibold text-card-foreground">
              {correctCount} of {questionCount} correct
            </Text>
            <Text variant="caption">
              {describeMargin(percent, passingScore)}
            </Text>
          </View>
        </View>

        <View className="flex-row flex-wrap gap-2">
          <ResultStat
            Icon={CircleCheck}
            color={theme.success}
            value={`${correctCount}`}
            label="Correct"
          />
          <ResultStat
            Icon={CircleX}
            color={theme.destructive}
            value={`${wrongCount}`}
            label="Wrong"
          />
          <ResultStat
            Icon={CircleMinus}
            color={theme.mutedForeground}
            value={`${skippedCount}`}
            label="Skipped"
          />
          <ResultStat
            Icon={Timer}
            color={theme.primary}
            value={formatDuration(durationSeconds)}
            label="Time"
          />
        </View>
      </CardContent>
    </Card>
  )
})

/**
 * One figure under the score. Four across on a phone; below about 300pt of
 * content they wrap two by two rather than shrinking the numbers.
 */
const ResultStat = memo(function ResultStat({
  Icon,
  color,
  value,
  label,
}: {
  Icon: typeof Timer
  color: string
  value: string
  label: string
}) {
  return (
    <View
      className="items-center gap-1 rounded-md px-1.5 py-2.5"
      style={{
        flexBasis: "22%",
        flexGrow: 1,
        minWidth: 64,
        backgroundColor: withOpacity(color, 0.08),
      }}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <Icon size={16} color={color} strokeWidth={2.4} />
      <Text
        className="text-base font-extrabold leading-5 text-card-foreground"
        numberOfLines={1}
      >
        {value}
      </Text>
      <Text variant="caption" numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
})
