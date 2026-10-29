import { Fragment, memo, type ReactNode } from "react"
import CircleCheck from "lucide-react-native/icons/circle-check"
import Clock3 from "lucide-react-native/icons/clock-3"
import Flame from "lucide-react-native/icons/flame"
import Target from "lucide-react-native/icons/target"
import { View } from "react-native"

import { cn } from "@/lib/utils"
import { useThemePalette } from "@/hooks/use-theme"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Text } from "@/components/ui/text"

/**
 * ─── Key figures ──────────────────────────────────────────────────────────
 *
 * Four numbers, one source each. The old profile showed "Average score" in
 * one card and "Accuracy rate" in another, computed from different tables, so
 * the same member could read 68% and 74% on one screen. Accuracy now comes
 * only from answers, and the session average lives in Exam readiness.
 *
 * One strip of four in a single card, divided by hairlines: the figures are
 * read together, and four separate tiles took two rows and a screen's worth
 * of height to say four numbers.
 */

/**
 * "980", "1.2k", "15k" — short enough for a quarter-width column. Done by
 * hand rather than with `notation: "compact"`, which Hermes does not support
 * on every Android version.
 */
function formatCount(value: number) {
  if (value < 1000) {
    return String(Math.max(Math.round(value), 0))
  }

  const thousands = value / 1000
  return `${thousands < 10 ? thousands.toFixed(1).replace(/\.0$/, "") : Math.round(thousands)}k`
}

/** "45m" under an hour, "1.5h" under ten, whole hours after that. */
function formatStudyTime(hours: number) {
  if (hours <= 0) {
    return "0h"
  }

  if (hours < 1) {
    return `${Math.max(Math.round(hours * 60), 1)}m`
  }

  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`
}

type ProfileStatsGridProps = {
  isLoading: boolean
  questionsAnswered: number
  accuracyPercent: number
  dayStreak: number
  hoursStudied: number
}

export const ProfileStatsGrid = memo(function ProfileStatsGrid({
  isLoading,
  questionsAnswered,
  accuracyPercent,
  dayStreak,
  hoursStudied,
}: ProfileStatsGridProps) {
  const theme = useThemePalette()

  if (isLoading) {
    return <Skeleton className="h-[86px] rounded-xl" />
  }

  const accuracy = Math.round(accuracyPercent)

  const stats = [
    {
      key: "answered",
      icon: <CircleCheck size={15} color={theme.primary} strokeWidth={2.4} />,
      value: formatCount(questionsAnswered),
      label: "Answered",
      spoken: `${questionsAnswered} questions answered`,
    },
    {
      key: "accuracy",
      icon: <Target size={15} color={theme.success} strokeWidth={2.4} />,
      value: `${accuracy}%`,
      label: "Accuracy",
      spoken: `${accuracy} percent of answers correct`,
      valueClass: accuracy >= 75 ? "text-success" : undefined,
    },
    {
      key: "streak",
      icon: <Flame size={15} color={theme.destructive} strokeWidth={2.4} />,
      value: formatCount(dayStreak),
      label: "Day streak",
      spoken: `${dayStreak} ${dayStreak === 1 ? "day" : "days"} in a row`,
    },
    {
      key: "time",
      icon: <Clock3 size={15} color={theme.chart4} strokeWidth={2.4} />,
      value: formatStudyTime(hoursStudied),
      label: "Studied",
      spoken: `${formatStudyTime(hoursStudied)} studied`,
    },
  ]

  return (
    <Card>
      <View className="flex-row py-3.5">
        {stats.map((stat, index) => (
          <Fragment key={stat.key}>
            {index > 0 ? <View className="my-1 w-px bg-border/70" /> : null}
            <Stat
              icon={stat.icon}
              value={stat.value}
              label={stat.label}
              spoken={stat.spoken}
              valueClass={stat.valueClass}
            />
          </Fragment>
        ))}
      </View>
    </Card>
  )
})

function Stat({
  icon,
  value,
  label,
  spoken,
  valueClass,
}: {
  icon: ReactNode
  value: string
  label: string
  spoken: string
  valueClass?: string
}) {
  return (
    <View
      className="min-w-0 flex-1 items-center gap-1 px-1"
      accessible
      accessibilityLabel={spoken}
    >
      {icon}
      <Text
        numberOfLines={1}
        className={cn(
          "text-lg font-extrabold leading-6 text-card-foreground",
          valueClass
        )}
      >
        {value}
      </Text>
      <Text variant="caption" numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}
