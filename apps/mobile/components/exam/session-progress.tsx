import { memo } from "react"
import { View } from "react-native"

import { withOpacity } from "@/lib/theme"
import { useThemePalette } from "@/hooks/use-theme"

/**
 * How far through the sitting they are.
 *
 * A filled track rather than a percentage label: the denominator here is the
 * run length, and members read position far faster than they read "43%". The
 * words ("Question 3 of 20 · 2 answered") live in the top bar beside it, so
 * this stays a single quiet line under the controls.
 *
 * Two layers: what has been answered, tinted, under where they are now, solid.
 * Jumping ahead past unanswered items is then visible at a glance.
 */

type SessionProgressProps = {
  position: number
  total: number
  answeredCount: number
}

export const SessionProgress = memo(function SessionProgress({
  position,
  total,
  answeredCount,
}: SessionProgressProps) {
  const theme = useThemePalette()
  const safeTotal = Math.max(total, 1)
  const positionPercent = Math.min((position / safeTotal) * 100, 100)
  const answeredPercent = Math.min((answeredCount / safeTotal) * 100, 100)

  return (
    <View
      className="h-1.5 overflow-hidden rounded-full"
      style={{ backgroundColor: theme.muted }}
      accessibilityRole="progressbar"
      accessibilityLabel={`Question ${position} of ${total}, ${answeredCount} answered`}
      accessibilityValue={{ min: 0, max: total, now: position }}
    >
      <View
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          width: `${answeredPercent}%`,
          backgroundColor: withOpacity(theme.primary, 0.3),
        }}
      />
      <View
        className="h-full rounded-full"
        style={{ width: `${positionPercent}%`, backgroundColor: theme.primary }}
      />
    </View>
  )
})
