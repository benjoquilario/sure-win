import { memo } from "react"
import Check from "lucide-react-native/icons/check"
import Lightbulb from "lucide-react-native/icons/lightbulb"
import X from "lucide-react-native/icons/x"
import { View } from "react-native"

import { withOpacity } from "@/lib/theme"
import { useThemePalette } from "@/hooks/use-theme"
import { Text } from "@/components/ui/text"

/**
 * The verdict and the rationale, shown once an answer is revealed.
 *
 * Whether it appears at all is `feedbackTiming` plus `showExplanations`
 * (section 8): under `at_end` nothing is revealed during the run, and this
 * component is simply not rendered.
 *
 * The explanation is body text, not a caption. It is the reason a reviewer
 * exists — the part a member actually learns from — so it is set at reading
 * size in the foreground color rather than shrunk into the muted footnote it
 * used to be.
 */

type ExplanationPanelProps = {
  isCorrect: boolean
  /** The right answer, spelled out — shown when they got it wrong. */
  correctAnswerLabel?: string
  correctAnswerText?: string
  explanation?: string
  showExplanation?: boolean
}

export const ExplanationPanel = memo(function ExplanationPanel({
  isCorrect,
  correctAnswerLabel,
  correctAnswerText,
  explanation,
  showExplanation = true,
}: ExplanationPanelProps) {
  const theme = useThemePalette()
  const accent = isCorrect ? theme.success : theme.destructive
  const accentForeground = isCorrect
    ? theme.successForeground
    : theme.destructiveForeground
  const Icon = isCorrect ? Check : X
  const hasExplanation = showExplanation && Boolean(explanation)

  return (
    <View
      className="gap-3 rounded-md border px-4 py-3.5"
      style={{
        borderColor: withOpacity(accent, 0.25),
        backgroundColor: withOpacity(accent, 0.07),
      }}
      accessibilityLiveRegion="polite"
    >
      <View className="flex-row items-center gap-2.5">
        <View
          className="h-6 w-6 items-center justify-center rounded-full"
          style={{ backgroundColor: accent }}
        >
          <Icon size={14} color={accentForeground} strokeWidth={3} />
        </View>
        <Text className="text-base font-extrabold" style={{ color: accent }}>
          {isCorrect ? "Correct" : "Not quite"}
        </Text>
      </View>

      {!isCorrect && correctAnswerText ? (
        <View className="flex-row items-start gap-2.5">
          {correctAnswerLabel ? (
            <View
              className="h-6 w-6 items-center justify-center rounded-full"
              style={{ backgroundColor: withOpacity(theme.success, 0.18) }}
            >
              <Text
                className="text-2xs font-black"
                style={{ color: theme.success }}
              >
                {correctAnswerLabel}
              </Text>
            </View>
          ) : null}
          <View className="min-w-0 flex-1 gap-0.5">
            <Text variant="caption" className="font-semibold">
              Correct answer
            </Text>
            <Text className="text-sm font-semibold leading-5 text-foreground">
              {correctAnswerText}
            </Text>
          </View>
        </View>
      ) : null}

      {hasExplanation ? (
        <View
          className="gap-1.5 border-t pt-3"
          style={{ borderColor: withOpacity(accent, 0.2) }}
        >
          <View className="flex-row items-center gap-1.5">
            <Lightbulb
              size={13}
              color={theme.mutedForeground}
              strokeWidth={2.4}
            />
            <Text variant="eyebrow" className="text-muted-foreground">
              Why
            </Text>
          </View>
          <Text className="text-sm leading-6 text-foreground">
            {explanation}
          </Text>
        </View>
      ) : null}
    </View>
  )
})
